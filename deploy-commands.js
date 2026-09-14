require('dotenv').config();

const {
REST,
Routes,
SlashCommandBuilder
} = require('discord.js');

const commands = [

// 🌸 HELLO
new SlashCommandBuilder()
.setName('hello')
.setDescription('Say hello to Momo Radio!')
.toJSON(),

// 🎧 JOIN
new SlashCommandBuilder()
.setName('join')
.setDescription('Have Momo Radio join your voice channel!')
.toJSON(),

// 🧪 TEST
new SlashCommandBuilder()
.setName('test')
.setDescription('Play Momo Radio\'s test sound!')
.toJSON(),

// 🎵 PLAY
new SlashCommandBuilder()
.setName('play')
.setDescription('Play a song or add it to the queue!')
.addStringOption(option =>
option
.setName('song')
.setDescription('Song name or URL')
.setRequired(true)
)
.toJSON(),

// ⏭ SKIP
new SlashCommandBuilder()
.setName('skip')
.setDescription('Skip the current song.')
.toJSON(),

// ⏸ PAUSE
new SlashCommandBuilder()
.setName('pause')
.setDescription('Pause the current song.')
.toJSON(),

// ▶️ RESUME
new SlashCommandBuilder()
.setName('resume')
.setDescription('Resume the paused song.')
.toJSON(),

// ⏹ STOP
new SlashCommandBuilder()
.setName('stop')
.setDescription('Stop playback and clear the queue.')
.toJSON(),

// 👋 LEAVE
new SlashCommandBuilder()
.setName('leave')
.setDescription('Have Momo Radio leave the voice channel.')
.toJSON(),

// 📜 QUEUE
new SlashCommandBuilder()
.setName('queue')
.setDescription('Show the current music queue.')
.toJSON(),

// 🎶 NOW PLAYING
new SlashCommandBuilder()
.setName('nowplaying')
.setDescription('Show the song currently playing.')
.toJSON(),

// 🗑 CLEAR
new SlashCommandBuilder()
.setName('clear')
.setDescription('Clear the upcoming queue.')
.toJSON()
];

const rest = new REST({ version: '10' })
.setToken(process.env.DISCORD_TOKEN);

(async () => {
try {

console.log('🌸 Registering Momo Radio commands...');

await rest.put(
Routes.applicationGuildCommands(
process.env.CLIENT_ID,
process.env.GUILD_ID
),
{
body: commands
}
);

console.log('🌸 Slash commands registered!');

} catch (error) {

console.error(
'❌ Something went wrong registering commands:'
);

console.error(error);
}
})();