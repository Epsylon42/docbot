const fs = require('fs-extra');
const requests = require('./requests.js');
const { Chain, Many, Exact, Pred, Either, Regex, Map } = require('./parser.js');

async function with_docs(config, callback) {
    let docs = null;
    try {
        docs = JSON.parse(await fs.readFile(config.documents));
    } catch (e) {
        docs = {};
    }
    const ret = await callback(docs);
    await fs.writeFile(config.documents, JSON.stringify(docs, null, 4));
    return ret;
}

function with_doc_id(config, name, callback) {
    return with_docs(config, async docs => {
        const lc = name.toLowerCase();
        if (!docs[lc]) {
            throw new Error(`Document for ${name} does not exist`);
        } else {
            return await callback(docs[lc]);
        }
    });
}

function name() {
    return new Regex(/[a-zA-Z]\w*/)
        .map(m => m[0])
        .err_msg("name");
}

function doc_id() {
    return new Regex(/[0-9a-zA-Z_\-]+/)
        .map(m => m[0])
        .err_msg("document id");
}


class Command {
    parse() {
        return new Chain().interleave_spaces();
    }

    prefix_parser() {
        let p = this.parse();

        for (const token of this.simple_prefix_parser()) {
            p.with(token);
        }

        return p;
    }

    arg_parser() {
        return this.parse();
    }
}

class Help extends Command {
    simple_prefix_parser() {
        return ['help'];
    }

    arg_parser() {
        return this.parse();
    }

    async execute() {
        return `DocBot help
all-capital words in triangle brackets are placeholders
square brackets mean optional parameters
curly braces mean multiple arguments
\`|\` means \`or\`

The author of this bot is good at writing parsers
but not very good at error handling, so expect
a lot of incomprehensible yelling thrown your
way when you make a typo

commands:
\`\`\`
`
            + AllCommands.map(Type => new Type().help()).join('\n')
            + '```';
    }

    help() {
        return `help: show this message`;
    }
}

class AddDocument extends Command {
    simple_prefix_parser() {
        return ['add', 'document'];
    }

    arg_parser() {
        return this.parse()
            .with(name())
            .with(doc_id())
            .named('name', 'id');
    }

    async execute({ name, id }, config, sheets) {
        await with_docs(config, docs => {
            const lc = name.toLowerCase();
            if (docs[lc]) {
                throw new Error(`Document with name ${name} already exists`);
            } else {
                docs[lc] = id;
            }
        });

        return `Successfully added document ${name}`;
    }

    help() {
        return
        `add document <NAME> <DOCUMENT-ID>:
    add a document to the bot's database
    <NAME> is a name you'll use to refer to that document later
    <DOCUMENT-ID> you can find in the document's url after .../spreadsheets/d/`;
    }
}

class RemoveDocument extends Command {
    simple_prefix_parser() {
        return ['remove', 'document'];
    }

    arg_parser() {
        return this.parse()
            .with(name())
            .named('name');
    }

    async execute({ name }, config, sheets) {
        await with_docs(config, docs => {
            const lc = name.toLowerCase();
            if (!docs[lc]) {
                throw new Error(`Document with name ${name} does not exist`);
            } else {
                docs[lc] = undefined;
            }
        });

        return `Successfully removed document ${name}`;
    }

    help() {
        return `remove document <NAME>`;
    }
}

class ListDocuments extends Command {
    simple_prefix_parser() {
        return ['list', 'documents'];
    }

    execute({}, config, sheets) {
        return with_docs(config, docs => {
            const str = Object
                  .entries(docs)
                  .map(([name, id]) => `${name}: ${id}`)
                  .join('\n');

            return '\n' + '```' + str + '```';
        });
    }

    help() {
        return `list documents`;
    }
}

class Show extends Command {
    simple_prefix_parser() {
        return ['show'];
    }

    arg_parser() {
        return this.parse()
            .with(name())
            .either(
                e => e
                    .with(new Exact('grist').branch('grist'))
                    .chain(
                        c => c
                            .interleave_spaces()
                            .either(
                                e => e
                                    .with(/[Pp]rospit/)
                                    .with(/[Dd]erse/)
                                    .map(s => s.toUpperCase())
                                    .opt()
                            )
                            .either(
                                e => e
                                    .with(new Exact('traits').branch('traits'))
                                    .with(
                                        new Many(
                                            new Chain()
                                                .with_spaces()
                                                .with(/\w+/)
                                                .map(arr => arr[0])
                                        )
                                            .at_least(1)
                                            .err_msg("a space-separated list of stats")
                                            .branch('other-stats')
                                    )
                            )
                            .named('moon', 'stats')
                            .branch('stats')
                    )
                    .map(obj => {
                        if (obj.branch === 'stats') {
                            return {
                                branch: obj.value.stats.branch,
                                value: {
                                    moon: obj.value.moon,
                                    stats: obj.value.stats.value
                                }
                            };
                        } else {
                            return obj;
                        }
                    })
                   )
            .named('name', 'args');
    }

    execute({ name, args: { branch, value: args } }, config, sheets) {
        return with_doc_id(config, name, async id => {
            if (branch === 'grist') {
                return await this.get_grist(name, id, config, sheets);
            } else {
                const moon = args.moon || '';
                const subsheet = moon || 'CHARACTER SHEET';

                if (branch === 'traits') {
                    const traits = await requests.getTraits(id, subsheet, config, sheets);
                    const str = traits.map(([trait, rating, mod]) => `${trait}: ${rating} (${mod})`).join('\n');
                    return '\n' + `${(moon + ' ' + name).trim()} traits:\n` + '```' + str + '```';
                } else {
                    const data = await requests.getData(id, subsheet, args.stats, config, sheets);
                    const str = data.map(([stat, value]) => `${stat}: ${value}`).join('\n');

                    return '\n' + `${(moon + ' ' + name).trim()}:\n` + '```' + str + '```';
                }
            }
        });
    }

    async get_grist(name, id, config, sheets) {
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
    }

    help() {
        return `
show <NAME> grist
show <NAME> [prospit|derse] traits
show <NAME> [prospit|derse] {<STAT>}:
    show specified stats
    the list is space-separated
    example:
        show Name stats vitality luck`;
    }
}

class Change extends Command {
    simple_prefix_parser() {
        return ['change'];
    }

    arg_parser() {
        const op = new Either()
              .with('add')
              .with('sub')
              .with('set')
              .err_msg("an operation (add|sub|set)");

        return this.parse()
            .with(name())
            .either(e => e
                    .chain(
                        c => c
                            .interleave_spaces()
                            .either(
                                e => e
                                    .with(/[Pp]rospit/)
                                    .with(/[Dd]erse/)
                                    .map(s => s.toUpperCase())
                                    .opt()
                            )
                            .either_hidden(
                                e => e
                                    .with('hp')
                                    .with('health')
                                    .with('vitality')
                            )
                            .with(op)
                            .either(
                                e => e
                                    .with(new Map(/[0-9]+/, Number))
                                    .with('max')
                                    .err_msg("an integer or 'max'")
                            )
                            .named('moon', 'op', 'amount')
                            .branch('hp')
                            .err_msg("vitality change")
                    )
                    .chain(
                        c => c
                            .interleave_spaces()
                            .with_hidden(
                                new Either()
                                    .with('xp')
                                    .with('experience')
                                    .with('exp')
                            )
                            .with(op)
                            .with(new Map(/[0-9]+/, Number).err_msg("an integer"))
                            .named('op', 'amount')
                            .branch('xp')
                            .err_msg("experience change")
                    )
                    .chain(
                        c => c
                            .interleave_spaces()
                            .with_hidden('grist')
                            .with(
                                new Many(
                                    new Chain()
                                        .interleave_spaces()
                                        .with(
                                            new Map(/\w+/, s => s.toLowerCase())
                                                .err_msg("grist type")
                                        )
                                        .with(op)
                                        .with(
                                            new Map(/[0-9]+/, Number)
                                                .err_msg("an integer")
                                        )
                                        .either_hidden(
                                            e => e
                                                .with(';')
                                                .with('\n')
                                                .with(Pred.eoi())
                                                .err_msg("a separator (a semicolon or a new line)")
                                        )
                                        .named('type', 'op', 'amount')
                                ).at_least(1)
                            )
                            .map(arr => arr[0])
                            .branch('grist')
                            .err_msg("grist change")
                    )
                   )
            .named('name', 'args');
    }

    execute({ name, args: { branch, value: args } }, config, sheets) {
        switch (branch) {
        case 'hp':
            return this.change_vitality(config, sheets, { name, ...args });
            break;

        case 'xp':
            return this.change_exp(config, sheets, { name, ...args });
            break;

        case 'grist':
            return this.change_grist(config, sheets, { name, changes: args });
            break;
        }
    }

    async change_vitality(config, sheets, { name, op, amount, moon }) {
        const subsheet = moon || 'CHARACTER SHEET';

        const [[, viscosity]] = await with_doc_id(config, name, id => requests.getData(
            id, subsheet, ['viscosity'], config, sheets
        ));

        if (!Number.isInteger(Number(viscosity))) {
            throw new Error(`The sheet has invalid *gel viscosity* value: ${viscosity}`);
        }

        if (amount === 'max') {
            amount = Number(viscosity);
        }

        const { old_val, new_val, overflow } = await this.change_value(config, sheets, {
            name, op, amount,
            field: 'vitality',
            subsheet,
            max: Number(viscosity),
            clamp_max: true,
        });

        let ret = `Vitality changes for ${name}: was ${old_val}, became ${new_val}`;
        if (overflow) {
            ret += `\nTried to make vitality higher than maximum value. Value set to ${viscosity}`;
        }
        if (new_val < 0) {
            ret += '\nYou vitality is below zero. Good luck.';
        }

        return ret;
    }

    async change_exp(config, sheets, { name, op, amount }) {
        const { old_val, new_val, underflow } = await this.change_value(config, sheets, {
            name, op, amount,
            field: 'xp',
            subsheet: 'CHARACTER SHEET',
            min: 0,
            clamp_min: true,
        });

        let ret = `Xp changes for ${name}: was ${old_val}, became ${new_val}`;
        if (underflow) {
            ret += '\nTried to subtract more xp than you have. Value set to 0';
        }

        return ret;
    }

    change_value(config, sheets, { name, op, amount, field, subsheet, max, min, clamp_min, clamp_max }) {
        return with_doc_id(config, name, async id => {
            const [[, current_value]] = await requests.getData(id, subsheet, [field], config, sheets);

            let new_value = Number(current_value) || 0;
            switch (op) {
            case 'add':
                new_value += amount;
                break;

            case 'sub':
                new_value -= amount;
                break;

            case 'set':
                new_value = amount;
                break;
            }

            let overflow = false;
            let underflow = false;
            if (max != null && new_value > max) {
                if (clamp_max) {
                    new_value = max;
                    overflow = true;
                } else {
                    throw new Error('overflow');
                }
            }
            if (min != null && new_value < min) {
                if (clamp_min) {
                    new_value = min;
                    underflow = true;
                } else {
                    throw new Error('underflow');
                }
            }

            const [[, old_val, new_val]] = await requests.setData(
                id, subsheet, [[field, new_value]], config, sheets
            );

            return {
                old_val,
                new_val,
                overflow,
                underflow,
            };
        });
    }

    change_grist(config, sheets, { name, changes }) {
        const has_repetitions = changes
              .filter((value, index, self) => self.indexOf(value) === index)
              .length !== changes.length;
        if (has_repetitions) {
            throw new Error('You can only each grist type only once');
        }

        return with_doc_id(config, name, async id => {
            const current_values = await requests.getGrist(
                id, config, sheets, changes.map(({ type }) => type)
            );

            const invalid_subtract = changes
                  .filter(({ op }) => op === 'sub')
                  .filter(({ amount }, i) => amount > Number(current_values[i][1]))
                  .map(({ type, amount }, i) => [type, current_values[i][1], amount]);
            if (invalid_subtract.length !== 0) {
                throw new Error(
                    'Tried to subtract more grist than you have:\n' +
                        '```' +
                        invalid_subtract.map(([type, current, delta]) => `build: current ${current}, tried to subtract ${delta}`).join('\n') +
                        '```'
                );
            }

            const new_values = changes
                  .map(({ type, op, amount }, i) => {
                      let new_value = Number(current_values[i][1]) || 0;
                      switch(op) {
                      case 'add':
                          new_value += amount;
                          break;
                      case 'sub':
                          new_value -= amount;
                          break;
                      case 'set':
                          new_value = amount;
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

    help() {
        return `
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

change <NAME> experience|xp|exp <OPERATION> <AMOUNT>:
    pretty much the same as above but for xp
    allowed operations: add, sub, set

change <NAME> [prospit|derse] vitality|hp|health <OPERATION> <AMOUNT>|max:
    change health
`;
    }
}

class Roll extends Command {
    simple_prefix_parser() {
        return ['roll'];
    }

    arg_parser() {
        return new Either()
            .chain(
                c => c
                    .interleave_spaces()
                    .with(name())
                    .either(
                        e => e
                            .with(/[Pp]rospit/)
                            .with(/[Dd]erse/)
                            .map(s => s.toUpperCase())
                            .opt()
                    )
                    .with(new Regex(/\w+/).map(m => m[0]).err_msg("a trait"))
                    .named('name', 'moon', 'trait')
                    .branch('trait')
            )
            .chain(
                c => c
                    .chain(
                        c => c
                            .with_spaces()
                            .with(new Map(/[1-9][0-9]*/, Number))
                            .with_hidden('d')
                            .with(new Map(/[1-9][0-9]*/, Number))
                            .with_spaces()
                            .err_msg("dice description (XdY)")
                    )
                    .with(
                        new Many(
                            new Chain()
                                .interleave_spaces()
                                .with(
                                    new Either()
                                        .with('+')
                                        .with('-')
                                        .err_msg("an operation (+|-)")
                                )
                                .with(
                                    new Map(/[1-9][0-9]*/, Number)
                                        .err_msg("an integer (dice modifier)")
                                )
                                .named('op', 'mod')
                        )
                    )
                    .map(([[num, size], mods]) => ({ num, size, mods }))
                    .branch('custom')
            )
            .err_msg("roll description")
    }

    execute({ branch, value: args }, config, sheets) {
        switch (branch) {
        case 'trait':
            return this.roll_trait(config, sheets, args);
            break;

        case 'custom':
            return this.roll_custom(config, sheets, args);
            break;
        }
    }

    roll_trait(config, sheets, { name, moon, trait }) {
        const subsheet = moon || 'CHARACTER SHEET';
        const traitmap = config.docmap[subsheet].traits;

        const number = traitmap[trait.toUpperCase()] || traitmap[requests.aliases[trait.toLowerCase()]];
        if (number == null) {
            throw new Error(`Unknown trait: ${trait}`);
        }

        return with_doc_id(config, name, async id => {
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

    async roll_custom(config, sheets, { num, size, mods }) {
        let modifiers_string = mods
              .map(({ op, mod }) => `${op} ${mod}`)
              .join(' ');
        if (modifiers_string.length !== 0) {
            modifiers_string = ' ' + modifiers_string;
        }

        const mod = mods
              .map(({ op, mod }) => Number(op + mod))
              .reduce((a, b) => a + b, 0);

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

            return `roll (1d${size}${modifiers_string}): ${decorate(rolls[0])}${modifiers_string} = __${rolls[0] + mod}__`;
        } else if (rolls.length <= 10) {
            return `roll (${num}d${size}${modifiers_string}): \`[${rolls.join(' + ')}]\`${modifiers_string} = __${rolls.reduce((a, b) => a + b) + mod}__`;
        } else {
            const longest = rolls
                  .map(roll => String(roll).length)
                  .reduce((a, b) => a > b ? a : b);

            const pad = roll => roll + ' '.repeat(longest - String(roll).length);

            const chunks = new Array(Math.ceil(rolls.length / 10))
                  .fill(0)
                  .map((_, i) => rolls.slice(i*10, (i+1)*10));

            return `roll (${num}d${size}${modifiers_string}):` +
                '```[\n' +
                chunks
                .map(chunk => ' '.repeat(4) + chunk.map(roll => pad(roll)).join(' + '))
                .join('\n')
                + '\n]```' +
                `${modifiers_string} = __${rolls.reduce((a, b) => a + b) + mod}__`;
        }
    }

    help() {
        return `
roll <NUM>d<SIZE> {+|- <MODIFIER>}:
    rolls dice
    example:
        roll 1d20
        roll 10d4 + 5 - 1
        roll 2d8 - 1

roll <NAME> [prospit|derse] <TRAIT>:
    rolls 1d20 using specified trait as a modifier
    example:
        roll Name str`;
    }
}

const AllCommands = [
    Help,
    AddDocument,
    RemoveDocument,
    ListDocuments,
    Show,
    Change,
    Roll,
];

module.exports = AllCommands;
