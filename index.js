const fs = require('fs-extra');
const gapi = require('googleapis');
const Discord = require('discord.js');

const auth = require('./auth.js');
const requests = require('./requests.js');
const commands = require('./commands.js');
const { ParserInput, ParserError } = require('./parser.js');


async function run() {
    const config = JSON.parse(await fs.readFile(process.env.CONFIG));

    const gapi_auth = await auth.authorize(config);
    const sheets = gapi.google.sheets({ version: 'v4', auth: gapi_auth });

    const client = new Discord.Client();

    const cmds = commands
          .map(Type => {
              const cmd = new Type();
              const prefix = cmd.prefix_parser();
              const arg = cmd.arg_parser();

              return [prefix, arg, cmd];
          });

    client.on('message', msg => {
        if (msg.mentions.users.find(u => u.id == client.user.id)) {
            let content = '';
            const trimmed = msg.content.trim();
            if (trimmed.startsWith('<@')) {
                const space = trimmed.indexOf(' ');
                content = trimmed.slice(space);
            } else {
                content = trimmed;
            }

            let matched = false;
            for (const [prefix, arg, cmd] of cmds) {
                try {
                    let [, rest] = prefix.parse(new ParserInput(content));
                    matched = true;

                    try {
                        let [args] = arg.parse(rest);

                        cmd.execute(args, config, sheets)
                            .then(response => msg.reply(response))
                            .catch(e => {
                                msg.reply(`Error: ${e.message}`);
                                console.error(e);
                            })
                    } catch (e) {
                        if (e instanceof ParserError) {
                            msg.reply(`Parsing error: ${e.message}`);
                            console.error(e);
                            break;
                        } else {
                            msg.reply(`Error: ${e.message}`);
                            throw e;
                        }
                    }
                } catch (e) {
                    if (!(e instanceof ParserError)) {
                        console.error(e);
                    }
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
