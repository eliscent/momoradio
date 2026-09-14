require('dotenv').config();

const path = require('path');

const {
Client,
GatewayIntentBits,
Events,
EmbedBuilder,
ActionRowBuilder,
ButtonBuilder,
ButtonStyle,
StringSelectMenuBuilder
} = require('discord.js');

const { Player } = require('discord-player');

const {
DefaultExtractors
} = require('@discord-player/extractor');

const {
joinVoiceChannel,
createAudioPlayer,
createAudioResource,
AudioPlayerStatus,
VoiceConnectionStatus,
entersState
} = require('@discordjs/voice');

const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildVoiceStates
]
});

// 🌸 Create Momo's music player
const player = new Player(client, {
connectionTimeout: 30000
});

// 🌸 Load extractors
(async () => {
await player.extractors.loadMulti(DefaultExtractors);
console.log('🌸 Momo Radio extractors loaded!');
})();

client.once(Events.ClientReady, () => {
console.log(`🌸 Momo Radio is online as ${client.user.tag}!`);

console.log('\n===== MOMO DEPENDENCY REPORT =====');
console.log(player.scanDeps());
console.log('==================================\n');
});

// ======================================================
// 🌸 PLAYER BUTTONS
// ======================================================

function createPlayerButtons() {
return new ActionRowBuilder().addComponents(

new ButtonBuilder()
.setCustomId('momo_pause')
.setLabel('Pause')
.setEmoji('⏸️')
.setStyle(ButtonStyle.Secondary),

new ButtonBuilder()
.setCustomId('momo_resume')
.setLabel('Resume')
.setEmoji('▶️')
.setStyle(ButtonStyle.Success),

new ButtonBuilder()
.setCustomId('momo_skip')
.setLabel('Skip')
.setEmoji('⏭️')
.setStyle(ButtonStyle.Primary),

new ButtonBuilder()
.setCustomId('momo_stop')
.setLabel('Stop')
.setEmoji('⏹️')
.setStyle(ButtonStyle.Danger)
);
}

// ======================================================
// 🌸 SONG SEARCH MENUS
// ======================================================

const pendingSearches = new Map();
const intentionallyStoppedTracks = new Set();

function looksLikeUrl(text) {
    return /^https?:\/\//i.test(text);
}

function shorten(text, max = 95) {
    if (!text) return 'Unknown';

    if (text.length <= max) return text;

    return text.slice(0, max - 3) + '...';
}

// ======================================================
// 🎶 PLAYER EVENTS
// ======================================================

player.events.on('playerStart', (queue, track) => {
    const channel = queue.metadata?.channel;
    if (!channel) return;

const embed = new EmbedBuilder()
    .setColor(0xF4A7B9)
    .setAuthor({
        name: 'Momo Radio 🌸'
    })
    .setTitle(track.title)
    .setDescription(
        `**${track.author || 'Unknown Artist'}**\n\n` +
        `Now playing in **Cherry Blossom Cafe**`
    )
    .setThumbnail(track.thumbnail || null)
    .addFields(
        {
            name: '⏱️ Duration',
            value: track.duration || 'Unknown',
            inline: true
        },
        {
            name: '🎧 Requested by',
            value: track.requestedBy?.toString() || 'Unknown',
            inline: true
        }
    )
    .setFooter({
        text: 'Cherry Blossom Cafe • Momo Radio'
    });

const buttons = createPlayerButtons();

channel.send({
embeds: [embed],
components: [buttons]
}).catch(console.error);

console.log(`🎶 Now playing: ${track.title}`);

// ==================================================
// 🥀 CHECK FOR DEAD / INSTANTLY-ENDING STREAMS
// ==================================================

const startedTrackId = track.id;

setTimeout(() => {
    const currentTrack = queue.currentTrack;
    const stillPlaying = queue.node.isPlaying();

    const sameTrack =
        currentTrack &&
        currentTrack.id === startedTrackId;

    if (sameTrack && stillPlaying) {
        return;
    }

    // If the track disappeared almost immediately,
    // the remote stream probably died.

    if (intentionallyStoppedTracks.has(startedTrackId)) {
        intentionallyStoppedTracks.delete(startedTrackId);
        return;
    }

    if (!sameTrack || !stillPlaying) {
        const channel = queue.metadata?.channel;

        console.log(
            `🥀 ${track.title} stopped within the first 3 seconds.`
        );

        if (!channel) return;

        channel.send(
            `🥀 **That version wouldn't play.**\n` +
            `**${track.title}** ended almost immediately, so that upload is probably unavailable.\n\n` +
            `🌸 Try another result from your search!`
        ).catch(console.error);
    }
}, 3000);

});

player.events.on('playerError', (queue, error) => {
    console.error('❌ Player error:', error);

    const channel = queue.metadata?.channel;

    if (channel) {
        channel.send(
            '🥺 Momo had trouble playing that song.'
        ).catch(console.error);
    }
});

player.events.on('playerSkip', (queue, track, reason, description) => {
    const channel = queue.metadata?.channel;

    console.log(`🥀 Momo skipped an unplayable track: ${track.title}`);
    console.log(`Reason: ${reason}`);
    console.log(`Description: ${description}`);

    if (!channel) return;

    channel.send(
        `🥀 **That version wouldn't play.**\n` +
        `**${track.title}** couldn't be streamed, so Momo skipped it.\n\n` +
        `🌸 Try another result from your search!`
    ).catch(console.error);
});

player.events.on('error', (queue, error) => {
    console.error('❌ Queue error:', error);
});

// ======================================================
// 🌸 INTERACTIONS
// ======================================================

client.on(Events.InteractionCreate, async interaction => {

// ==================================================
// 🌸 SONG SEARCH DROPDOWN
// ==================================================

if (
    interaction.isStringSelectMenu() &&
    interaction.customId.startsWith('momo_search_')
) {
    const search = pendingSearches.get(interaction.customId);

    if (!search) {
        await interaction.reply({
            content: '🥺 That search expired! Try `/play` again.',
            ephemeral: true
        });

        return;
    }

    if (interaction.user.id !== search.userId) {
        await interaction.reply({
            content: '🌸 This song menu belongs to the person who searched for it!',
            ephemeral: true
        });

        return;
    }

    const selectedIndex = Number(interaction.values[0]);
    const selectedTrack = search.tracks[selectedIndex];

    if (!selectedTrack) {
        await interaction.reply({
            content: '🥺 Momo couldn\'t find that selection anymore.',
            ephemeral: true
        });

        return;
    }

    const voiceChannel = interaction.guild.channels.cache.get(
        search.voiceChannelId
    );

    if (!voiceChannel) {
        await interaction.reply({
            content: '🥺 Momo can\'t find that voice channel anymore.',
            ephemeral: true
        });

        return;
    }

    await interaction.deferUpdate();

    try {
        const result = await player.play(
            voiceChannel,
            selectedTrack,
            {
                requestedBy: interaction.user,

                nodeOptions: {
                    metadata: {
                        channel: interaction.channel
                    },

                    volume: 80,

                    leaveOnEmpty: true,
                    leaveOnEmptyCooldown: 300000,

                    leaveOnEnd: true,
                    leaveOnEndCooldown: 300000
                }
            }
        );

        pendingSearches.delete(interaction.customId);

        await interaction.editReply({
            content:
                `🌸 **Added to Momo Radio:** ${result.track.title}\n` +
                `🎧 ${result.track.author || 'Unknown Artist'}`,
            embeds: [],
            components: []
        });

    } catch (error) {
        console.error('❌ Search selection error:');
        console.error(error);

        await interaction.editReply({
            content:
                '🥺 Momo had trouble playing that selection. Try another version!',
            embeds: [],
            components: []
        });
    }

    return;
}

// ==================================================
// 🌸 BUTTONS
// ==================================================

if (interaction.isButton()) {

const queue = player.nodes.get(interaction.guild.id);

if (!queue) {
await interaction.reply({
content: '🌸 There isn\'t an active music queue!',
ephemeral: true
});

return;
}

try {

// ⏸ PAUSE BUTTON
if (interaction.customId === 'momo_pause') {

if (!queue.isPlaying()) {
await interaction.reply({
content: '🌸 Nothing is playing right now!',
ephemeral: true
});

return;
}

queue.node.setPaused(true);

await interaction.reply({
content: '⏸️ Momo paused the music!',
ephemeral: true
});

return;
}

// ▶️ RESUME BUTTON
if (interaction.customId === 'momo_resume') {

if (!queue.node.isPaused()) {
await interaction.reply({
content: '🌸 The music isn\'t paused right now!',
ephemeral: true
});

return;
}

queue.node.setPaused(false);

await interaction.reply({
content: '▶️ Momo resumed the music!',
ephemeral: true
});

return;
}

const currentTrack = queue.currentTrack;

// ⏭ SKIP BUTTON
if (interaction.customId === 'momo_skip') {

if (!queue.isPlaying()) {
await interaction.reply({
content: '🌸 Nothing is playing right now!',
ephemeral: true
});

return;
}

if (currentTrack) {
    intentionallyStoppedTracks.add(currentTrack.id);
}

queue.node.skip();

await interaction.reply({
content: '⏭️ Momo skipped the song!',
ephemeral: true
});

return;
}

// ⏹ STOP BUTTON
if (interaction.customId === 'momo_stop') {

const currentTrack = queue.currentTrack;

if (currentTrack) {
    intentionallyStoppedTracks.add(currentTrack.id);
}

queue.delete();

await interaction.reply({
content: '⏹️ Momo stopped the music and cleared the queue!',
ephemeral: true
});

return;
}

} catch (error) {
console.error('❌ Button error:');
console.error(error);

if (!interaction.replied) {
await interaction.reply({
content: '🥺 Momo had trouble with that button.',
ephemeral: true
}).catch(() => {});
}
}

return;
}

// ==================================================
// 🌸 SLASH COMMANDS
// ==================================================

if (!interaction.isChatInputCommand()) return;

const command = interaction.commandName;

try {

// 🌸 HELLO
if (command === 'hello') {
await interaction.reply(
'🌸 **Momo Radio is on air!**\nReady to bring some tunes to Cherry Blossom Cafe ♡'
);

return;
}

// 🎧 JOIN
if (command === 'join') {
const voiceChannel = interaction.member.voice.channel;

if (!voiceChannel) {
await interaction.reply(
'🌸 You need to join a voice channel first so Momo knows where to go!'
);

return;
}

joinVoiceChannel({
channelId: voiceChannel.id,
guildId: interaction.guild.id,
adapterCreator: interaction.guild.voiceAdapterCreator
});

await interaction.reply(
`🎧 **Momo Radio has joined ${voiceChannel.name}!**`
);

return;
}

// 🧪 TEST MP3
if (command === 'test') {
const voiceChannel = interaction.member.voice.channel;

if (!voiceChannel) {
await interaction.reply(
'🌸 Join a voice channel first, then try `/test` again!'
);

return;
}

await interaction.deferReply();

const connection = joinVoiceChannel({
channelId: voiceChannel.id,
guildId: interaction.guild.id,
adapterCreator: interaction.guild.voiceAdapterCreator
});

await entersState(
connection,
VoiceConnectionStatus.Ready,
15000
);

const audioPlayer = createAudioPlayer();

const audioPath = path.join(__dirname, 'test.mp3');

const resource = createAudioResource(audioPath);

connection.subscribe(audioPlayer);

audioPlayer.play(resource);

await interaction.editReply(
'🎶 **Momo Radio is playing her test sound!**'
);

audioPlayer.on(AudioPlayerStatus.Idle, () => {
console.log('🌸 Test audio finished playing!');
});

return;
}

// 🎵 PLAY
if (command === 'play') {
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
        await interaction.reply(
            '🌸 Join a voice channel first so Momo knows where to play!'
        );

        return;
    }

    const query = interaction.options.getString('song', true);

    await interaction.deferReply();

// ==================================================
// 🔗 DIRECT LINK
// ==================================================

if (looksLikeUrl(query)) {

    // ==================================================
    // 💚 SPOTIFY LINK
    // ==================================================

    if (
        query.includes('open.spotify.com/track/') ||
        query.startsWith('spotify:track:')
    ) {
        const spotifyResult = await player.search(query, {
            requestedBy: interaction.user,
            searchEngine: 'spotifySong'
        });

        if (!spotifyResult.hasTracks()) {
            await interaction.editReply(
                '🥺 Momo couldn\'t read that Spotify track.'
            );

            return;
        }

        const spotifyTrack = spotifyResult.tracks[0];

        const soundcloudQuery =
            `${spotifyTrack.title} ${spotifyTrack.author}`;

        const soundcloudResult = await player.search(
            soundcloudQuery,
            {
                requestedBy: interaction.user,
                searchEngine: 'soundcloudSearch'
            }
        );

        if (!soundcloudResult.hasTracks()) {
            await interaction.editReply(
                `🥺 Momo recognized **${spotifyTrack.title}** by ` +
                `**${spotifyTrack.author}**, but couldn't find a playable SoundCloud version.`
            );

            return;
        }

        const tracks = soundcloudResult.tracks.slice(0, 5);

        const searchId =
            `momo_search_${interaction.id}`;

        pendingSearches.set(searchId, {
            userId: interaction.user.id,
            voiceChannelId: voiceChannel.id,
            tracks
        });

        setTimeout(() => {
            pendingSearches.delete(searchId);
        }, 120000);

        const menu = new StringSelectMenuBuilder()
            .setCustomId(searchId)
            .setPlaceholder('🌸 Choose a playable version...')
            .addOptions(
                tracks.map((track, index) => ({
                    label: shorten(track.title),
                    description: shorten(
                        `${track.author || 'Unknown Artist'} • ` +
                        `${track.duration || 'Unknown'}`
                    ),
                    value: String(index)
                }))
            );

        const row = new ActionRowBuilder()
            .addComponents(menu);

        const embed = new EmbedBuilder()
            .setColor(0xF4A7B9)
            .setTitle('🌸 Momo found your Spotify song!')
            .setDescription(
                `**Spotify track:**\n` +
                `${spotifyTrack.title}\n` +
                `${spotifyTrack.author || 'Unknown Artist'}\n\n` +

                `**Playable versions:**\n\n` +

                tracks
                    .map(
                        (track, index) =>
                            `**${index + 1}. ${track.title}**\n` +
                            `${track.author || 'Unknown Artist'} • ` +
                            `${track.duration || 'Unknown'}`
                    )
                    .join('\n\n')
            )
            .setFooter({
                text:
                    'Choose a SoundCloud version below • Cherry Blossom Cafe'
            });

        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });

        return;
    }

    // ==================================================
    // 🔗 OTHER DIRECT LINKS
    // ==================================================

    const result = await player.play(
        voiceChannel,
        query,
        {
            requestedBy: interaction.user,

            nodeOptions: {
                metadata: {
                    channel: interaction.channel
                },

                volume: 80,

                leaveOnEmpty: true,
                leaveOnEmptyCooldown: 300000,

                leaveOnEnd: true,
                leaveOnEndCooldown: 300000
                }
            }
        );

        await interaction.editReply(
            `🌸 **Added to Momo Radio:** ${result.track.title}`
        );

        return;
    }

    // ==================================================
    // 🔎 SONG NAME SEARCH
    // ==================================================

    const searchResult = await player.search(query, {
        requestedBy: interaction.user,
        searchEngine: 'soundcloudSearch'
    });

    if (!searchResult.hasTracks()) {
        await interaction.editReply(
            '🥺 Momo couldn\'t find anything for that search.'
        );

        return;
    }

    const tracks = searchResult.tracks.slice(0, 5);

    const searchId = `momo_search_${interaction.id}`;

    pendingSearches.set(searchId, {
        userId: interaction.user.id,
        voiceChannelId: voiceChannel.id,
        tracks
    });

    setTimeout(() => {
        pendingSearches.delete(searchId);
    }, 120000);

    const menu = new StringSelectMenuBuilder()
        .setCustomId(searchId)
        .setPlaceholder('🌸 Choose a song...')
        .addOptions(
            tracks.map((track, index) => ({
                label: shorten(track.title),
                description: shorten(
                    `${track.author || 'Unknown Artist'} • ${track.duration || 'Unknown'}`
                ),
                value: String(index)
            }))
        );

    const row = new ActionRowBuilder()
        .addComponents(menu);

    const embed = new EmbedBuilder()
        .setColor(0xF4A7B9)
        .setTitle('🌸 Momo found a few matches!')
        .setDescription(
            tracks
                .map(
                    (track, index) =>
                        `**${index + 1}. ${track.title}**\n` +
                        `${track.author || 'Unknown Artist'} • ${track.duration || 'Unknown'}`
                )
                .join('\n\n')
        )
        .setFooter({
            text: 'Choose the version you want below • Cherry Blossom Cafe'
        });

    await interaction.editReply({
        embeds: [embed],
        components: [row]
    });

    return;
}

// ⏭ SKIP
if (command === 'skip') {
const queue = player.nodes.get(interaction.guild.id);

if (!queue || !queue.isPlaying()) {
await interaction.reply(
'🌸 Nothing is playing right now!'
);

return;
}

queue.node.skip();

await interaction.reply(
'⏭️ **Skipped!**'
);

return;
}

// ⏸ PAUSE
if (command === 'pause') {
const queue = player.nodes.get(interaction.guild.id);

if (!queue || !queue.isPlaying()) {
await interaction.reply(
'🌸 Nothing is playing right now!'
);

return;
}

queue.node.setPaused(true);

await interaction.reply(
'⏸️ **Paused!**'
);

return;
}

// ▶️ RESUME
if (command === 'resume') {
const queue = player.nodes.get(interaction.guild.id);

if (!queue || !queue.node.isPaused()) {
await interaction.reply(
'🌸 Nothing is paused right now!'
);

return;
}

queue.node.setPaused(false);

await interaction.reply(
'▶️ **Resumed!**'
);

return;
}

// ⏹ STOP
if (command === 'stop') {
const queue = player.nodes.get(interaction.guild.id);

if (!queue) {
await interaction.reply(
'🌸 Nothing is playing right now!'
);

return;
}

queue.delete();

await interaction.reply(
'⏹️ **Playback stopped and the queue was cleared!**'
);

return;
}

// 👋 LEAVE
if (command === 'leave') {
const queue = player.nodes.get(interaction.guild.id);

if (!queue) {
await interaction.reply(
'🌸 Momo isn\'t playing anything right now!'
);

return;
}

queue.delete();

await interaction.reply(
'👋 **Momo Radio left the voice channel!**'
);

return;
}

// 📜 QUEUE
if (command === 'queue') {
const queue = player.nodes.get(interaction.guild.id);

if (!queue) {
await interaction.reply(
'🌸 There isn\'t an active music queue!'
);

return;
}

const current = queue.currentTrack;

const upcoming = queue.tracks
.toArray()
.slice(0, 10);

let description = '';

if (current) {
description +=
`**🎶 Now Playing**\n` +
`${current.title}\n\n`;
}

if (upcoming.length > 0) {
description +=
'**🌸 Up Next**\n' +
upcoming
.map(
(track, index) =>
`${index + 1}. ${track.title}`
)
.join('\n');
} else {
description += '*Nothing else is queued.*';
}

const embed = new EmbedBuilder()
.setTitle('🌸 Momo Radio Queue')
.setDescription(description)
.setFooter({
text: 'Cherry Blossom Cafe'
});

await interaction.reply({
embeds: [embed]
});

return;
}

// 🎶 NOW PLAYING
if (command === 'nowplaying') {
const queue = player.nodes.get(interaction.guild.id);

if (!queue || !queue.currentTrack) {
await interaction.reply(
'🌸 Nothing is playing right now!'
);

return;
}

const track = queue.currentTrack;

const embed = new EmbedBuilder()
    .setColor(0xF4A7B9)
    .setAuthor({
        name: 'Momo Radio 🌸'
    })
    .setTitle(track.title)
    .setDescription(
        `**${track.author || 'Unknown Artist'}**\n\n` +
        `Now playing in **Cherry Blossom Cafe**`
    )
    .setThumbnail(track.thumbnail || null)
    .addFields(
        {
            name: '⏱️ Duration',
            value: track.duration || 'Unknown',
            inline: true
        },
        {
            name: '🎧 Requested by',
            value: track.requestedBy?.toString() || 'Unknown',
            inline: true
        }
    )
    .setFooter({
        text: 'Cherry Blossom Cafe • Momo Radio'
    });

const buttons = function createPlayerButtons() {
    return new ActionRowBuilder().addComponents(

        new ButtonBuilder()
            .setCustomId('momo_pause')
            .setLabel('Pause')
            .setEmoji('⏸️')
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId('momo_resume')
            .setLabel('Play')
            .setEmoji('▶️')
            .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
            .setCustomId('momo_skip')
            .setLabel('Skip')
            .setEmoji('⏭️')
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId('momo_stop')
            .setLabel('Stop')
            .setEmoji('⏹️')
            .setStyle(ButtonStyle.Danger)
    );
};

await interaction.reply({
embeds: [embed],
components: [buttons]
});

return;
}

// 🗑 CLEAR
if (command === 'clear') {
const queue = player.nodes.get(interaction.guild.id);

if (!queue) {
await interaction.reply(
'🌸 The queue is already empty!'
);

return;
}

queue.tracks.clear();

await interaction.reply(
'🗑️ **Upcoming songs cleared!**'
);

return;
}

} catch (error) {
console.error('❌ Momo command error:');
console.error(error);

const message =
'🥺 Momo ran into a problem. Check the terminal and send me the error!';

if (interaction.deferred || interaction.replied) {
await interaction.editReply(message).catch(() => {});
} else {
await interaction.reply(message).catch(() => {});
}
}
});

client.login(process.env.DISCORD_TOKEN);