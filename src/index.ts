import 'dotenv/config';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

global.__rootdir__ = __dirname || process.cwd();
global.__rootdir__ = __dirname || process.cwd();
declare global {
    var __rootdir__: string;
}

import './sentry.js';

import { Keyword, Postgres, Server, WhitelistedEmoji, initialize as initializeDatabase } from './database.js';
import { loadContextMenus, loadMessageCommands, loadSlashCommands, synchronizeSlashCommands } from './handlers/commands.js';

import { syncSheets } from './integrations/sheets.js';

import { Client, IntentsBitField } from 'discord.js';
import { loadTasks } from './handlers/tasks.js';
import { In } from 'typeorm';
export const client = new Client({
    intents: [
        IntentsBitField.Flags.Guilds,
        IntentsBitField.Flags.GuildMessages,
        IntentsBitField.Flags.GuildMessageReactions,
        IntentsBitField.Flags.MessageContent
    ]
});

const { slashCommands, slashCommandsData } = loadSlashCommands(client);
const { contextMenus, contextMenusData } = loadContextMenus(client);
const messageCommands = loadMessageCommands(client);
loadTasks(client);

synchronizeSlashCommands(client, [...slashCommandsData, ...contextMenusData], {
    debug: true,
    guildId: process.env.GUILD_ID
});

client.on('interactionCreate', async (interaction) => {

    if (interaction.isCommand()) {

        const isContext = interaction.isContextMenuCommand();
        if (isContext) {
            const run = contextMenus.get(interaction.commandName);
            if (!run) return;
            run(interaction, interaction.commandName);
        } else {
            const run = slashCommands.get(interaction.commandName);
            if (!run) return;
            run(interaction, interaction.commandName);
        }
    }

});

client.on('messageCreate', async (message) => {

    if (message.author.bot) return;

    const keywords = await Postgres.getRepository(Keyword).find({
        where: {
            channelId: message.channelId,
            kind: 'startswith'
        }
    });

    const noneMatch = keywords.length > 0 && keywords.every(key => !message.content.startsWith(key.text));

    if (noneMatch) {
        message.delete().catch(() => {});
        return message.author.send(`${message.author.username}, your message has been deleted. Every message in this channel has to start with one of these.\n\n${keywords.map(key => "- `" + key.text + "`").join(`\n`)}`);
    }

    if (!process.env.COMMAND_PREFIX) return;
    
    const args = message.content.slice(process.env.COMMAND_PREFIX.length).split(/ +/);
    const commandName = args.shift();

    if (!commandName) return;

    const run = messageCommands.get(commandName);
    
    if (!run) return;

    run(message, commandName);

});

client.on('ready', async () => {
    console.log(`Logged in as ${client.user!.tag}. Ready to serve ${client.users.cache.size} users in ${client.guilds.cache.size} servers 🚀`);

    if (process.env.DB_NAME) {
        initializeDatabase().then(() => {
            console.log('Database initialized 📦');

            syncServers();
        });
    } else {
        console.log('Database not initialized, as no keys were specified 📦');
    }

    if (process.env.SPREADSHEET_ID) {
        syncSheets();
    }

});

export const syncServers = async () => {
    // delete all the servers that are not part of the bot anymore
    const serversIds: string[] = client.guilds.cache.map(guild => guild.id);
    const storedServers = await Postgres.getRepository(Server).find({});

    for (const server of storedServers) {
        const id = server.serverId;
        if (!serversIds.includes(id)) {
            Postgres.getRepository(Keyword).delete({
                server: {
                    serverId: id
                }
            });
            Postgres.getRepository(WhitelistedEmoji).delete({
                server: {
                    serverId: id
                }
            });
            Postgres.getRepository(Server).delete({ serverId: id });
        } else {
            Postgres.getRepository(Server).update({ serverId: id }, { name: client.guilds.cache.get(id)?.name });
        }
    }

    const newlyCreatedServerIds = serversIds.filter(id => !storedServers.map(server => server.serverId).includes(id));

    for (const id of newlyCreatedServerIds) {
        Postgres.getRepository(Server).insert({ serverId: id, name: client.guilds.cache.get(id)?.name });
    }

    client.channels.cache.forEach(channel => {
        if (channel.isTextBased()) {
            channel.messages.fetch({ limit: 100, cache: true }).then(() => console.log(`Fetched messages for ${(channel as any)?.name}`));
        }
    });
}

client.on('guildCreate', () => syncServers());
client.on('guildDelete', () => syncServers());

client.on('messageReactionAdd', async (reaction, user) => {
    if (!reaction.message.guildId) return;

    const whitelistedEmojis = await Postgres.getRepository(WhitelistedEmoji).find({
        where: {
            server: {
                serverId: reaction.message.guildId
            }
        }
    });

    const emoji = reaction.emoji.id ? `<:${reaction.emoji.name}:${reaction.emoji.id}>` : reaction.emoji.name;

    console.log(whitelistedEmojis.map(e => e.emojiUnicodeOrId), emoji);

    if (!whitelistedEmojis.find(e => e.emojiUnicodeOrId === emoji)) {
        // @ts-ignore
        reaction.users.remove(user);

        user.send(`${user.username}, you reacted with an emoji that is not allowed in this server. Every reaction in this server has to be one of these.\n\n${whitelistedEmojis.map(e => "- " + e.emojiUnicodeOrId).join(`\n`)}`);
    }

});

client.login(process.env.DISCORD_CLIENT_TOKEN);
