const fs = require('fs-extra');
const gapi = require('googleapis');
const Discord = require('discord.js');

const auth = require('./auth.js');
const requests = require('./requests.js');

async function test() {
    const config = JSON.parse(await fs.readFile(process.env.CONFIG));
    const client = await auth.authorize(config);

    const response = await traits('jace', 'CHARACTER SHEET', config, gapi.google.sheets({ version: 'v4', auth: client }));

    console.log(response);
}

async function withDocs(config, callback) {
    const docs = JSON.parse(await fs.readFile(config.documents));
    const ret = await callback(docs);
    await fs.writeFile(config.documents, JSON.stringify(docs, null, 4));
    return ret;
}

function withDocId(config, name, callback) {
    return withDocs(config, async docs => {
        const lc = name.toLowerCase();
        if (!docs[lc]) {
            throw new Error(`Document for ${name} does not exist`);
        } else {
            return await callback(docs[lc]);
        }
    });
}



function addDocument(matches, msg, config, sheets) {
    const name = matches.groups.name;
    const id = matches.groups.id;

    return withDocs(config, docs => {
        const lc = name.toLowerCase();
        if (docs[lc]) {
            throw new Error(`Document with name ${name} already exists`);
        } else {
            docs[lc] = id;
        }
    })
        .then(() => `Successfully added document ${name}`);
}

function removeDocument(matches, msg, config, sheets) {
    const name = matches.groups.name;

    return withDocs(config, docs => {
        const lc = name.toLowerCase();
        if (!docs[lc]) {
            throw new Error(`Document with name ${name} does not exist`);
        } else {
            docs[lc] = undefined;
        }
    })
        .then(() => `Successfully removed document ${name}`);
}

function listDocuments(matches, msg, config, sheets) {
    return withDocs(config, docs => {
        const str = Object.entries(docs).map(([name, id]) => `${name}: ${id}`).join('\n');
        return '\n' + '```' + str + '```';
    });
}

function showTraits(matches, msg, config, sheets) {
    const name = matches.groups.name;

    const moon = (matches.groups.moon || '').trim().toLowerCase();
    const sheet = moon ? moon.toUpperCase() : "CHARACTER SHEET";

    return withDocId(config, name, async id => {
        const traits = await requests.getTraits(id, sheet, config, sheets);
        const str = traits.map(([trait, rating, mod]) => `${trait}: ${rating} (${mod})`).join('\n');
        return '\n' + `${(moon + ' ' + name).trim()} traits:\n` + '```' + str + '```';
    });
}

function showStats(matches, msg, config, sheets) {
    const name = matches.groups.name;
    const stats = matches.groups.stats.split(/,? /);

    const moon = (matches.groups.moon || '').trim().toLowerCase();
    const sheet = moon ? moon.toUpperCase() : "CHARACTER SHEET";

    return withDocId(config, name, async id => {
        const data = await requests.getData(id, "CHARACTER SHEET", stats, config, sheets);
        const str = data.map(([stat, value]) => `${stat}: ${value}`).join('\n');

        return '\n' + `${(moon + ' ' + name).trim()}:\n` + '```' + str + '```';
    });
}

function showGrist(matches, msg, config, sheets) {
    const name = matches.groups.name;

    return withDocId(config, name, async id => {
        const grist = await requests.getGrist(id, config, sheets);

        const pad_grist = arr => {
            const longest = arr
                  .map(pair => pair[0].length)
                  .reduce((a, b) => a > b ? a : b);

            return arr
                .map(([type, value]) => `${type}:` + ' '.repeat(longest - type.length + 1) + value);
        };

        const fst = pad_grist(grist.slice(0, 6));
        const snd = pad_grist(grist.slice(6));

        const longest = fst.map(s => s.length).reduce((a, b) => a > b ? a : b);
        const str = fst
              .map((s, i) => s + ' '.repeat(longest - s.length + 5) + snd[i])
              .join('\n');

        return '\n' + `${name} grist:\n` + '```' + str + '```';
    });
}

function changeGrist(matches, msg, config, sheets) {
    const name = matches.groups.name;

    const changes = matches.groups.changes
          .split(/(;|\n)\s*/)
          .filter(s => s.trim() !== '' && s !== ';')
          .map(s => s.split(' '))
          .map(([type, op, value]) => [type.toLowerCase(), op, value]);

    const has_repetitions = changes
          .map(triple => triple[0].toLowerCase())
          .filter((value, index, self) => self.indexOf(value) === index)
          .length !== changes.length;
    if (has_repetitions) {
        throw new Error('You can only each grist type only once');
    }

    return withDocId(config, name, async id => {
        const current_values = await requests.getGrist(
            id, config, sheets, changes.map(triple => triple[0])
        );

        const invalid_subtract = changes
              .filter(triple => triple[1] === 'sub')
              .filter((triple, i) => Number(triple[2]) > Number(current_values[i][1]))
              .map((triple, i) => [triple[0], current_values[i][1], triple[2]]);
        if (invalid_subtract.length !== 0) {
            throw new Error(
                'Tried to subtract more grist than you have:\n' +
                    '```' +
                    invalid_subtract.map(([type, current, delta]) => `build: current ${current}, tried to subtract ${delta}`).join('\n') +
                    '```'
            );
        }

        const new_values = changes
              .map(([type, op, delta], i) => {
                  let new_value = Number(current_values[i]) || 0;
                  switch(op) {
                  case 'add':
                      new_value += Number(delta);
                      break;
                  case 'sub':
                      new_value -= Number(delta);
                      break;
                  case 'set':
                      new_value = Number(delta);
                      break;
                  }

                  return [type, new_value];
              });

        const response = await requests.setGrist(id, config, sheets, new_values);

        return `Grist changes for ${name}:\n` +
            '```' +
            response.map(([type, old_val, new_val]) => `${type}: was ${old_val} became ${new_val}`).join('\n') +
            '```';
    })
}

function changeExp(matches, msg, config, sheets) {
    const name = matches.groups.name;
    const op = matches.groups.op;
    const amount = Number(matches.groups.amount);

    return withDocId(config, name, async id => {
        const [[, current_value]] = await requests.getData(id, "CHARACTER SHEET", ['xp'], config, sheets);

        let new_value = Number(current_value) || 0;
        switch(op) {
        case 'add':
            new_value += Number(amount);
            break;
        case 'sub':
            if (Number(amount) > new_value) {
                throw new Error(`Tried to subtract more xp than you have:\n current ${new_value}, tried to subtract ${amount}`);
            }
            new_value -= Number(amount);
            break;
        case 'set':
            new_value = Number(amount);
            break;
        }

        const [[, old_val, new_val]] = await requests.setData(
            id, "CHARACTER SHEET", [['xp', new_value]],
            config, sheets
        );

        return `Xp changes for ${name}: was ${old_val}, became ${new_val}`;
    });
}

async function help() {
    return `
DocBot help
all-capital words in triangle brackets are placeholders
square brackets mean optional parameters
curly braces mean multiple arguments
| means or

Also the author of this bot is not very good
at writing parsers so this part is kinda shitty.
Expect a lot of 'Unknown command's thrown at you

commands:
\`\`\`
help: show this message
add document <NAME> <DOCUMENT-ID>:
    add a document to the bot's database
    <NAME> is a name you'll use to refer to that document later
    <DOCUMENT-ID> you can find in the document's url after .../spreadsheets/d/

remove document <NAME>
list documents
show <NAME> grist
show [prospit|derse] <NAME> traits
show [prospit|derse] <NAME> {<STAT>}:
    show specified stats
    the list is space-separated
    example:
        show Name stats vitality luck

change <NAME> grist {<GRIST-TYPE> <OPERATION> <AMOUNT>;}
    change grist values
    allowed operations: add, sub, set
    the list is separated either by semicolons or by newlines
    example:
        change Name grist build add 5; shale sub 5; artifact set 5
        OR
        change Name grist
        build add 5
        shale sub 5
        artifact set 5

change <NAME> xp <OPERATION> <AMOUNT>:
    pretty much the same as above but for xp
    allowed operations: add, sub, set

roll <NUM>d<SIZE> [+|- <MODIFIER>]:
    rolls dice
    example:
        roll 1d20
        roll 10d4 + 5
        roll 2d8 - 1

roll <NAME> <TRAIT>:
    rolls 1d20 using specified trait as a modifier
    example:
        roll Name str
\`\`\`
`;
}

function rollTrait(matches, msg, config, sheets) {
    const name = matches.groups.name;
    const moon = (matches.groups.moon || '').trim().toLowerCase();
    const trait = matches.groups.trait;

    const subsheet = moon ? moon.toUpperCase() : 'CHARACTER SHEET';
    const traitmap = config.docmap[subsheet].traits;

    const number = traitmap[trait.toUpperCase()] || traitmap[requests.aliases[trait.toLowerCase()]];
    if (number == null) {
        throw new Error(`Unknown trait: ${trait}`);
    }

    return withDocId(config, name, async id => {
        const mod = await requests.batchGet(
            id, [`${subsheet}!${traitmap.mod}${number}`], sheets
        );

        const result = Math.floor(Math.random()*20) + 1;

        const decorate = num => {
            if (num == 1) {
                return `**${num}**`;
            } else if (num == 20) {
                return `**${num}**`;
            } else {
                return num;
            }
        };
        const op = mod < 0 ? '-' : '+';

        return `roll (1d20 + ${trait}): ${decorate(result)} ${op} ${Math.abs(mod)} = __${result + Number(mod)}__`;
    });
}

async function rollCustom(matches, msg, config, sheets) {
    const num = Number(matches.groups.num);
    const size = Number(matches.groups.size);
    const op = matches.groups.op;
    const mod = matches.groups.mod;
    const opmod = Number(op + mod) || 0;

    const op_and_mod = opmod == 0 ? '' : ` ${op} ${mod}`;

    if (num > 200) {
        throw new Error(`That's a lot of dice. Are you trying to kill me?`);
    }

    const rolls = new Array(num)
          .fill(0)
          .map(() => Math.floor(Math.random()*size) + 1);

    if (rolls.length == 1) {
        const decorate = num => {
            if (size == 20) {
                if (num == 1) {
                    return `**${num}**`;
                } else if (num == 20) {
                    return `**${num}**`;
                } else {
                    return num;
                }
            } else {
                return num;
            }
        }

        return `roll (1d${size}${op_and_mod}): ${decorate(rolls[0])}${op_and_mod} = __${rolls[0] + opmod}__`;
    } else if (rolls.length <= 10) {
        return `roll (${num}d${size}${op_and_mod}): [${rolls.join(' + ')}]${op_and_mod} = __${rolls.reduce((a, b) => a + b) + opmod}__`;
    } else {
        const longest = rolls
              .map(roll => String(roll).length)
              .reduce((a, b) => a > b ? a : b);

        const pad = roll => roll + ' '.repeat(longest - String(roll).length);

        const chunks = new Array(Math.ceil(rolls.length / 10))
              .fill(0)
              .map((_, i) => rolls.slice(i*10, (i+1)*10));

        return `roll (${num}d${size}${op_and_mod}):` +
            '```[\n' +
            chunks
            .map(chunk => ' '.repeat(4) + chunk.map(roll => pad(roll)).join(' + '))
            .join('\n')
        + '\n]```' +
        `${op_and_mod} = __${rolls.reduce((a, b) => a + b) + opmod}__`;
    }
}

const commands = [
    [/add document (?<name>\w+) (?<id>\w+)$/, addDocument],
    [/remove document (?<name>\w+)$/, removeDocument],
    [/list documents$/, listDocuments],
    [/show (?<name>\w+) grist$/, showGrist],
    [/show(?<moon> [Pp]rospit| [Dd]erse)? (?<name>\w+) traits$/, showTraits],
    [/show(?<moon> [Pp]rospit| [Dd]erse)? (?<name>\w+) (?<stats>(\w+,? )*\w+)$/, showStats],
    [/change (?<name>\w+) (xp|experience) (?<op>add|sub|set) (?<amount>[0-9]+)$/, changeExp],
    [/change (?<name>\w+) grist\s+(?<changes>([a-zA-Z]+ (add|sub|set) [0-9]+;?\s+)*[a-zA-Z]+ (add|sub|set) [0-9]+)$/, changeGrist],
    [/roll (?<num>[1-9][0-9]*)d(?<size>[1-9][0-9]*)( ?(?<op>\+|-) ?(?<mod>[0-9]+))?/, rollCustom],
    [/roll(?<moon> [Pp]rospit| [Dd]erse)? (?<name>\w+) (?<trait>\w+)/, rollTrait],
    [/help$/, help],
 ];



async function run() {
    const config = JSON.parse(await fs.readFile(process.env.CONFIG));

    const gapi_auth = await auth.authorize(config);
    const sheets = gapi.google.sheets({ version: 'v4', auth: gapi_auth });

    const client = new Discord.Client();

    client.on('message', msg => {
        if (msg.mentions.users.find(u => u.id == client.user.id)) {
            let matched = false;
            for (const [regex, cmd] of commands) {
                const matches = msg.content.match(regex);
                if (matches) {
                    matched = true;
                    try {
                        cmd(matches, msg, config, sheets)
                            .then(response => msg.reply(response))
                            .catch(err => {
                                msg.reply(`Error: ${err.message}`)
                                console.error(err);
                            });
                    } catch (err) {
                        msg.reply(`Error: ${err.message}`);
                        console.error(err);
                    }
                    break;
                }
            }

            if (!matched) {
                msg.reply("Unknown command");
            }
        }
    });

    client.login(config.bot_token);
}

run();
