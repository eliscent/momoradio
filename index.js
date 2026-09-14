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
   StringSelectMenuBuilder,
   MessageFlags
} = require('discord.js');

const {
   Player
} = require('discord-player');

const {
   DefaultExtractors
} = require('@discord-player/extractor');

const {
   YouTubeDlpExtractor
} = require('discord-player-youtubedlp');

const {
   joinVoiceChannel,
   createAudioPlayer,
   createAudioResource,
   AudioPlayerStatus,
   VoiceConnectionStatus,
   entersState
} = require('@discordjs/voice');


// ======================================================
// 🌸 MOMO RADIO
// ======================================================

const MOMO_COLOR = 0xF4A7B9;
const MOMO_NAME = 'Momo Radio 🌸';
const MOMO_CAFE = 'Cherry Blossom Cafe';


// ======================================================
// 🌸 CLIENT
// ======================================================

const client = new Client({
   intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates
   ]
});


// ======================================================
// 🌸 MUSIC PLAYER
// ======================================================

const player = new Player(client, {
   connectionTimeout: 30000
});


// ======================================================
// 🌸 SEARCH STATE
// ======================================================

const pendingSearches = new Map();


// ======================================================
// 🌸 INTENTIONAL SKIPS / STOPS
// ======================================================
//
// Map<trackId, reason>
//
// Used so Momo knows that a song stopping was intentional
// and should NOT trigger playback recovery.
// ======================================================

const intentionallyStoppedTracks = new Map();


// ======================================================
// 🌸 PLAYBACK RECOVERY
// ======================================================
//
// Momo gets TWO total attempts:
//
// Attempt 1 = original selected version
// Attempt 2 = alternative YouTube version
//
// After two failed attempts, Momo moves on.
// ======================================================

const recoveryStates = new Map();

const recoveryInProgress = new Set();

const MAX_PLAYBACK_ATTEMPTS = 2;


// ======================================================
// 🌸 IDLE DISCONNECT
// ======================================================
//
// Momo leaves the voice channel if:
//
// - there is no current song
// - there are no upcoming songs
// - nothing is playing
//
// She waits 10 minutes before leaving.
//
// 10 minutes = 600000 milliseconds.
// ======================================================

const IDLE_DISCONNECT_TIME = 10 * 60 * 1000;

const idleTimers = new Map();


// ======================================================
// 🌸 HELPERS
// ======================================================

async function safeReply(interaction, options) {

   try {

      if (
         interaction.deferred ||
         interaction.replied
      ) {

         return await interaction.editReply(
            options
         );
      }

      return await interaction.reply(
         options
      );

   } catch (error) {

      if (error?.code === 10062) {

         console.warn(
            '🌸 Momo: The Discord interaction had already expired.'
         );

         return null;
      }

      console.error(
         '🌸 Momo: Momo could not respond to the interaction.',
         error
      );

      return null;
   }
}


function looksLikeUrl(text) {

   return /^https?:\/\//i.test(text);
}


function isSpotifyUrl(text) {

   return (
      text.includes('open.spotify.com/track/') ||
      text.startsWith('spotify:track:')
   );
}


function isYouTubeUrl(text) {

   return (
      text.includes('youtube.com/') ||
      text.includes('youtu.be/')
   );
}


function shorten(text, max = 95) {

   if (!text) {
      return 'Unknown';
   }

   if (text.length <= max) {
      return text;
   }

   return text.slice(0, max - 3) + '...';
}


function getQueue(guildId) {

   return player.nodes.get(guildId);
}


// ======================================================
// 🌸 IDLE TIMER HELPERS
// ======================================================

function clearIdleTimer(guildId) {

   const timer =
      idleTimers.get(guildId);

   if (timer) {

      clearTimeout(timer);

      idleTimers.delete(guildId);

      console.log(
         '🌸 Momo: Her idle timer was cancelled.'
      );
   }
}


function startIdleTimer(queue) {

   if (
      !queue ||
      queue.deleted
   ) {
      return;
   }


   const guildId =
      queue.guild.id;


   // Never allow multiple idle timers
   // for the same guild.
   clearIdleTimer(
      guildId
   );


   console.log(
      `🌸 Momo: No music is waiting. Her ${IDLE_DISCONNECT_TIME / 60000}-minute idle timer has started.`
   );


   const timer =
      setTimeout(
         async () => {

               idleTimers.delete(
                  guildId
               );


               const currentQueue =
                  getQueue(guildId);


               if (
                  !currentQueue ||
                  currentQueue.deleted
               ) {

                  return;
               }


               // ==========================================
               // 🌸 MUSIC STARTED AGAIN
               // ==========================================

               if (
                  currentQueue.currentTrack ||
                  currentQueue.tracks.size > 0 ||
                  currentQueue.node.isPlaying() ||
                  currentQueue.node.isPaused()
               ) {

                  console.log(
                     '🌸 Momo: Music is active again, so she is staying.'
                  );

                  return;
               }


               const channel =
                  currentQueue.metadata?.channel;


               console.log(
                  `🌸 Momo: ${IDLE_DISCONNECT_TIME / 60000} minutes have passed without music.`
               );


               clearRecoveryState(
                  guildId
               );


               currentQueue.delete();


               if (channel) {

                  await channel
                     .send(
                        '🌸 Momo has been sitting quietly for a little while, ' +
                        'so she’s heading home for now ♡\n\n' +
                        '🎀 Just use `/play` whenever you want her back!'
                     )
                     .catch(
                        error =>
                        console.error(
                           '🌸 Momo: Could not send idle message.',
                           error
                        )
                     );
               }

            },
            IDLE_DISCONNECT_TIME
      );


   idleTimers.set(
      guildId,
      timer
   );
}


function checkForIdleQueue(queue) {

   if (
      !queue ||
      queue.deleted
   ) {
      return;
   }


   const guildId =
      queue.guild.id;


   const hasMusic =
      queue.currentTrack ||
      queue.tracks.size > 0 ||
      queue.node.isPlaying() ||
      queue.node.isPaused();


   if (hasMusic) {

      clearIdleTimer(
         guildId
      );

      return;
   }


   startIdleTimer(
      queue
   );
}


function getVoiceChannel(interaction) {

   return interaction.member?.voice?.channel;
}


function getQueueNumber(index) {

   const numbers = [
      '①',
      '②',
      '③',
      '④',
      '⑤',
      '⑥',
      '⑦',
      '⑧',
      '⑨',
      '⑩'
   ];

   return numbers[index] || `${index + 1}.`;
}


// ======================================================
// 🌸 PLAYER OPTIONS
// ======================================================

function getNodeOptions(interaction) {

   return {

      metadata: {
         channel: interaction.channel
      },

      volume: 80,

      // Momo still leaves if everyone leaves
      // the voice channel.
      leaveOnEmpty: true,

      // Keep this consistent with Momo's
      // 10-minute idle behavior.
      leaveOnEmptyCooldown: IDLE_DISCONNECT_TIME,

      // IMPORTANT:
      //
      // We disable Discord Player's built-in
      // leave-on-end behavior because Momo now
      // uses her own 10-minute idle timer.
      leaveOnEnd: false
   };
}


// ======================================================
// 🌸 PLAYER BUTTONS
// ======================================================

function createPlayerButtons() {

   return new ActionRowBuilder()
      .addComponents(

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
// 🌸 NOW PLAYING EMBED
// ======================================================

function createNowPlayingEmbed(track) {

   return new EmbedBuilder()

      .setColor(MOMO_COLOR)

      .setAuthor({
         name: MOMO_NAME
      })

      .setTitle(
         track.title || 'Momo is playing something lovely'
      )

      .setDescription(
         `**${track.author || 'Unknown Artist'}**\n\n` +
         `🎶 Playing now in **${MOMO_CAFE}** ♡`
      )

      .setThumbnail(
         track.thumbnail || null
      )

      .addFields(

         {
            name: '⏱️ Duration',

            value: track.duration ||
               'Momo is checking...',

            inline: true
         },

         {
            name: '🎧 Requested by',

            value: track.requestedBy?.toString() ||
               'A lovely listener',

            inline: true
         }
      )

      .setFooter({
         text: '🌸 Momo Radio • Cherry Blossom Cafe'
      });
}


// ======================================================
// 🌸 SEARCH MENU
// ======================================================

function createSearchMenu(
   searchId,
   tracks,
   placeholder = '🌸 Choose a song...'
) {

   const menu =
      new StringSelectMenuBuilder()

      .setCustomId(searchId)

      .setPlaceholder(
         placeholder
      )

      .addOptions(

         tracks.map(
            (track, index) => ({

               label: shorten(
                  track.title
               ),

               description: shorten(
                  `${track.author || 'Unknown Artist'} • ` +
                  `${track.duration || 'Unknown'}`
               ),

               value: String(index)
            })
         )
      );

   return new ActionRowBuilder()
      .addComponents(menu);
}


function createSearchEmbed(
   tracks,
   title = '🌸 Momo found a few matches!'
) {

   return new EmbedBuilder()

      .setColor(MOMO_COLOR)

      .setAuthor({
         name: `${MOMO_NAME} • ${MOMO_CAFE}`
      })

      .setTitle(title)

      .setDescription(

         tracks
         .map(
            (track, index) =>

            `**${index + 1}. ${shorten(track.title, 80)}**\n` +
            `${shorten(track.author || 'Unknown Artist', 70)} • ` +
            `${track.duration || 'Unknown'}`
         )

         .join('\n\n')
      )

      .setFooter({
         text: '🌸 Choose the version Momo should play'
      });
}


// ======================================================
// 🌸 RECOVERY HELPERS
// ======================================================

function createRecoveryState(track) {

   return {

      attempts: 1,

      triedIds: new Set([
         track.id
      ]),

      query: `${track.title || ''} ${track.author || ''}`.trim(),

      originalTitle: track.title ||
         'this song'
   };
}


function resetRecoveryState(
   guildId,
   track
) {

   recoveryStates.set(
      guildId,
      createRecoveryState(track)
   );
}


function clearRecoveryState(guildId) {

   recoveryStates.delete(
      guildId
   );
}


async function recoverPlayback(
   queue,
   failedTrack,
   reason = 'Unknown',
   description = ''
) {

   if (
      !queue ||
      queue.deleted ||
      !failedTrack
   ) {

      return false;
   }


   const guildId =
      queue.guild.id;


   // ==================================================
   // 🌸 PREVENT DOUBLE RECOVERY
   // ==================================================

   if (
      recoveryInProgress.has(guildId)
   ) {

      return false;
   }


   let state =
      recoveryStates.get(
         guildId
      );


   if (!state) {

      state =
         createRecoveryState(
            failedTrack
         );

      recoveryStates.set(
         guildId,
         state
      );
   }


   state.triedIds.add(
      failedTrack.id
   );


   // ==================================================
   // 🌸 TWO ATTEMPTS ONLY
   // ==================================================

   if (
      state.attempts >=
      MAX_PLAYBACK_ATTEMPTS
   ) {

      console.log(
         `🌸 Momo: ${state.originalTitle} has already had ${MAX_PLAYBACK_ATTEMPTS} chances.`
      );

      clearRecoveryState(
         guildId
      );

      const channel =
         queue.metadata?.channel;

      if (channel) {

         await channel
            .send(
               `🌸 Momo tried her best with **${state.originalTitle}**, ` +
               `but this version isn't cooperating.\n\n` +
               `🎀 Momo is moving on to the next song ♡`
            )
            .catch(
               error =>
               console.error(
                  '🌸 Momo: Could not send recovery message.',
                  error
               )
            );
      }

      return false;
   }


   recoveryInProgress.add(
      guildId
   );


   const channel =
      queue.metadata?.channel;


   try {

      if (channel) {

         await channel.send(
            `🌸 **Momo is having a tiny bit of trouble with ` +
            `${failedTrack.title}.**\n\n` +
            `🎀 Let Momo try another version...`
         );
      }


      console.log(
         `🌸 Momo: Looking for another version of "${state.query}".`
      );


      const searchResult =
         await player.search(
            state.query, {
               requestedBy: failedTrack.requestedBy,

               searchEngine: 'youtubeSearch'
            }
         );


      if (
         !searchResult ||
         !searchResult.hasTracks()
      ) {

         console.log(
            '🌸 Momo: No alternative version was found.'
         );

         if (channel) {

            await channel.send(
               `🌸 Momo looked everywhere she could, ` +
               `but couldn't find another version of ` +
               `**${state.originalTitle}**.\n\n` +
               `🎀 Momo will continue with the next song ♡`
            );
         }

         clearRecoveryState(
            guildId
         );

         return false;
      }


      const alternative =
         searchResult.tracks.find(
            track =>
            !state.triedIds.has(
               track.id
            )
         );


      if (!alternative) {

         console.log(
            '🌸 Momo: All alternative search results had already been tried.'
         );

         if (channel) {

            await channel.send(
               `🌸 Momo couldn't find a different version of ` +
               `**${state.originalTitle}**.\n\n` +
               `🎀 Let's move on to the next song ♡`
            );
         }

         clearRecoveryState(
            guildId
         );

         return false;
      }


      // ==================================================
      // 🌸 ATTEMPT #2
      // ==================================================

      state.attempts += 1;

      state.triedIds.add(
         alternative.id
      );


      console.log(
         `🌸 Momo: Recovery attempt ${state.attempts}/${MAX_PLAYBACK_ATTEMPTS} — ${alternative.title}`
      );


      if (channel) {

         await channel.send(
            `🌸 **Momo found another version!**\n\n` +
            `🎶 **${shorten(alternative.title, 80)}**\n` +
            `🎧 ${shorten(
                    alternative.author ||
                    'Unknown Artist',
                    70
                )}\n\n` +
            `♡ Momo will give this one a try...`
         );
      }


      // ==================================================
      // 🌸 PUT ALTERNATIVE AT FRONT
      // ==================================================

      queue.insertTrack(
         alternative,
         0
      );


      if (!queue.isPlaying()) {

         await queue.node.play();
      }


      return true;

   } catch (error) {

      console.error(
         '🌸 Momo: Something went wrong while looking for another version.',
         error
      );

      clearRecoveryState(
         guildId
      );

      if (channel) {

         await channel
            .send(
               `🌸 Momo couldn't find a working version this time.\n\n` +
               `🎀 Don't worry — Momo will continue with the next song ♡`
            )
            .catch(
               sendError =>
               console.error(
                  '🌸 Momo: Could not send recovery message.',
                  sendError
               )
            );
      }

      return false;

   } finally {

      recoveryInProgress.delete(
         guildId
      );
   }
}


// ======================================================
// 🌸 EXTRACTORS
// ======================================================

async function loadExtractors() {

   console.log(
      '🌸 Momo is preparing her music library...'
   );

   try {

      await player.extractors.loadMulti(
         DefaultExtractors
      );


      await player.extractors.register(
         YouTubeDlpExtractor, {
            agent: {
               autoCookiesFromBrowser: false
            },

            searchLimit: 5,

            searchTimeoutMs: 15000,

            videoTimeoutMs: 15000,

            debug: false
         }
      );


      console.log(
         '🌸 Momo has finished preparing her music library ♡'
      );

   } catch (error) {

      console.error(
         '🌸 Momo: Her music library could not be prepared.',
         error
      );

      throw error;
   }
}


// ======================================================
// 🌸 READY
// ======================================================

client.once(
   Events.ClientReady,
   async () => {

      console.log(
         `🌸 Momo Radio is awake and online as ${client.user.tag} ♡`
      );

      console.log(
         `🌸 Momo's little process number is ${process.pid}.`
      );


      console.log(
         '🌸 Momo is checking that all her music friends are ready...'
      );


      try {

         player.scanDeps();

         console.log(
            '🌸 Momo checked her music friends and everything looks ready ♡'
         );

      } catch (error) {

         console.error(
            '🌸 Momo: One of her music friends could not be checked.',
            error
         );
      }


      console.log(
         '🌸 Momo is ready for the Cherry Blossom Cafe ♡'
      );
   }
);


// ======================================================
// 🎶 PLAYER EVENTS
// ======================================================

player.events.on(
   'playerStart',
   (queue, track) => {

      // A song is playing again,
      // so there is no reason for Momo's idle timer.
      clearIdleTimer(
         queue.guild.id
      );


      const channel =
         queue.metadata?.channel;


      // ==================================================
      // 🌸 NEW SONG OR RECOVERY?
      // ==================================================

      const recovery =
         recoveryStates.get(
            queue.guild.id
         );


      if (
         !recovery ||
         !recovery.triedIds.has(
            track.id
         )
      ) {

         resetRecoveryState(
            queue.guild.id,
            track
         );
      }


      console.log(
         `🌸 Momo is now playing: ${track.title}`
      );


      if (!channel) {
         return;
      }


      const embed =
         createNowPlayingEmbed(
            track
         );


      const buttons =
         createPlayerButtons();


      channel
         .send({
            embeds: [embed],
            components: [buttons]
         })
         .catch(
            error =>
            console.error(
               '🌸 Momo: Could not send the now-playing message.',
               error
            )
         );


      // ==================================================
      // 🌸 EARLY STREAM FAILURE DETECTOR
      // ==================================================

      const startedTrackId =
         track.id;


      setTimeout(
         async () => {

               const currentTrack =
                  queue.currentTrack;

               const stillPlaying =
                  queue.node.isPlaying();

               const sameTrack =
                  currentTrack &&
                  currentTrack.id ===
                  startedTrackId;


               if (
                  sameTrack &&
                  stillPlaying
               ) {

                  return;
               }


               // ==================================================
               // 🌸 INTENTIONAL SKIP / STOP?
               // ==================================================

               if (
                  intentionallyStoppedTracks.has(
                     startedTrackId
                  )
               ) {

                  intentionallyStoppedTracks.delete(
                     startedTrackId
                  );

                  return;
               }


               // ==================================================
               // 🌸 UNEXPECTED EARLY FAILURE
               // ==================================================

               console.log(
                  `🌸 Momo noticed that "${track.title}" stopped very quickly.`
               );


               await recoverPlayback(
                  queue,
                  track,
                  'EARLY_STOP',
                  'Momo noticed the song stopped almost immediately.'
               );

            },
            3000
      );
   }
);


// ======================================================
// 🌸 PLAYER ERROR
// ======================================================

player.events.on(
   'playerError',
   async (
      queue,
      error,
      track
   ) => {

      console.error(
         '🌸 Momo: A music stream became unavailable.',
         error
      );


      const failedTrack =
         track ||
         queue.currentTrack;


      if (!failedTrack) {

         const channel =
            queue.metadata?.channel;


         if (channel) {

            await channel
               .send(
                  `🌸 Momo couldn't keep the music going just now.\n\n` +
                  `🎀 Momo will continue with the next song ♡`
               )
               .catch(
                  sendError =>
                  console.error(
                     '🌸 Momo: Could not send player message.',
                     sendError
                  )
               );
         }

         return;
      }


      await recoverPlayback(
         queue,
         failedTrack,
         'PLAYER_ERROR',
         error?.message ||
         'Momo received an unexpected playback problem.'
      );
   }
);


// ======================================================
// ⏭ PLAYER SKIP
// ======================================================

player.events.on(
   'playerSkip',
   async (
      queue,
      track,
      reason,
      description
   ) => {

      if (!track) {
         return;
      }


      const channel =
         queue.metadata?.channel;


      // ==================================================
      // ⏭ INTENTIONAL SKIP
      // ==================================================

      if (
         reason === 'MANUAL'
      ) {

         const skipReason =
            intentionallyStoppedTracks.get(
               track.id
            );


         console.log(
            `🌸 Momo skipped: ${track.title}`
         );


         if (skipReason) {

            console.log(
               `🌸 Momo knows this was intentional: ${skipReason}.`
            );
         }


         // We no longer need to remember this track.
         intentionallyStoppedTracks.delete(
            track.id
         );


         if (channel) {

            const message =
               `⏭️ Momo skipped **${track.title}** ♡`;


            channel
               .send(message)
               .catch(
                  error =>
                  console.error(
                     '🌸 Momo: Could not send skip message.',
                     error
                  )
               );
         }


         // ==================================================
         // 🌸 IMPORTANT
         // ==================================================
         //
         // If there is no next song, start the custom
         // 10-minute idle timer.
         //
         // We wait a moment because Discord Player may
         // still be updating the queue after skip().
         // ==================================================

         setTimeout(
            () => {

               const currentQueue =
                  getQueue(
                     queue.guild.id
                  );


               if (
                  currentQueue &&
                  !currentQueue.currentTrack &&
                  currentQueue.tracks.size === 0
               ) {

                  startIdleTimer(
                     currentQueue
                  );
               }

            },
            500
         );


         return;
      }


      // ==================================================
      // 🌸 ACTUAL PLAYBACK FAILURE
      // ==================================================

      console.log(
         `🌸 Momo couldn't keep "${track.title}" playing.`
      );

      console.log(
         `🌸 Momo received playback reason: ${reason}`
      );

      console.log(
         `🌸 Momo received playback details: ${description || 'No additional details.'}`
      );


      // ==================================================
      // 🌸 AUTOMATIC RECOVERY
      // ==================================================

      const recovered =
         await recoverPlayback(
            queue,
            track,
            reason,
            description
         );


      if (
         !recovered
      ) {

         const currentQueue =
            getQueue(
               queue.guild.id
            );


         if (
            currentQueue &&
            !currentQueue.currentTrack &&
            currentQueue.tracks.size === 0
         ) {

            startIdleTimer(
               currentQueue
            );
         }
      }
   }
);


// ======================================================
// 🌸 PLAYER FINISHED
// ======================================================

player.events.on(
   'playerFinish',
   queue => {

      if (
         !queue ||
         queue.deleted
      ) {
         return;
      }


      const hasUpcomingSongs =
         queue.tracks.size > 0;


      // If another song is waiting,
      // there is no idle period.
      if (
         hasUpcomingSongs
      ) {

         clearIdleTimer(
            queue.guild.id
         );

         return;
      }


      console.log(
         '🌸 Momo: The playlist has finished. She is starting her idle timer.'
      );


      startIdleTimer(
         queue
      );
   }
);


// ======================================================
// 🌸 QUEUE ERROR
// ======================================================

player.events.on(
   'error',
   (queue, error) => {

      console.error(
         '🌸 Momo: Something unexpected happened with a music queue.',
         error
      );
   }
);


// ======================================================
// 🌸 INTERACTIONS
// ======================================================

client.on(
   Events.InteractionCreate,
   async interaction => {

      // ==================================================
      // 🌸 SONG SEARCH DROPDOWN
      // ==================================================

      if (
         interaction.isStringSelectMenu() &&
         interaction.customId.startsWith(
            'momo_search_'
         )
      ) {

         const search =
            pendingSearches.get(
               interaction.customId
            );


         if (!search) {

            await interaction.reply({

               content: '🌸 Momo’s song menu has gone to sleep.\n\n' +
                  '🎀 Try `/play` again and Momo will search for it ♡',

               flags: MessageFlags.Ephemeral
            });

            return;
         }


         if (
            interaction.user.id !==
            search.userId
         ) {

            await interaction.reply({

               content: '🌸 This little song menu belongs to the person who asked Momo to search ♡',

               flags: MessageFlags.Ephemeral
            });

            return;
         }


         const selectedIndex =
            Number(
               interaction.values[0]
            );


         const selectedTrack =
            search.tracks[
               selectedIndex
            ];


         if (!selectedTrack) {

            await interaction.reply({

               content: '🌸 Momo lost sight of that song selection.\n\n' +
                  '🎀 Please use `/play` again ♡',

               flags: MessageFlags.Ephemeral
            });

            return;
         }


         const voiceChannel =
            interaction.guild.channels.cache.get(
               search.voiceChannelId
            );


         if (!voiceChannel) {

            await interaction.reply({

               content: '🌸 Momo can’t find the voice room anymore.\n\n' +
                  '🎀 Join a voice channel and ask Momo again ♡',

               flags: MessageFlags.Ephemeral
            });

            return;
         }


         await interaction.deferUpdate();


         try {

            const result =
               await player.play(
                  voiceChannel,
                  selectedTrack, {

                     requestedBy: interaction.user,

                     nodeOptions: getNodeOptions(
                        interaction
                     )
                  }
               );


            // A new song has successfully been
            // added, so cancel any idle timer.
            clearIdleTimer(
               interaction.guild.id
            );


            console.log(
               `🌸 Momo added: ${result.track.title}`
            );


            pendingSearches.delete(
               interaction.customId
            );


            await interaction.editReply({

               content: `🌸 **Momo added it to the cafe playlist!**\n\n` +
                  `🎶 **${result.track.title}**\n` +
                  `🎧 ${result.track.author || 'Unknown Artist'}\n\n` +
                  `♡ Enjoy the music!`,

               embeds: [],

               components: []
            });


         } catch (error) {

            console.error(
               '🌸 Momo: Something went wrong with the selected song.',
               error
            );


            await interaction.editReply({

               content: '🌸 Momo couldn’t start that version.\n\n' +
                  '🎀 Try choosing another one from the list ♡',

               embeds: [],

               components: []
            });
         }


         return;
      }


      // ==================================================
      // 🌸 BUTTONS
      // ==================================================

      if (
         interaction.isButton()
      ) {

         const queue =
            getQueue(
               interaction.guild.id
            );


         if (!queue) {

            await interaction.reply({

               content: '🌸 Momo isn’t playing anything right now ♡',

               flags: MessageFlags.Ephemeral
            });

            return;
         }


         try {

            // ==========================================
            // ⏸ PAUSE
            // ==========================================

            if (
               interaction.customId ===
               'momo_pause'
            ) {

               if (
                  !queue.isPlaying()
               ) {

                  await interaction.reply({

                     content: '🌸 Momo isn’t playing anything at the moment ♡',

                     flags: MessageFlags.Ephemeral
                  });

                  return;
               }


               queue.node.setPaused(
                  true
               );


               await interaction.reply({

                  content: '⏸️ Momo tucked the music into a little pause ♡',

                  flags: MessageFlags.Ephemeral
               });

               return;
            }


            // ==========================================
            // ▶ RESUME
            // ==========================================

            if (
               interaction.customId ===
               'momo_resume'
            ) {

               if (
                  !queue.node.isPaused()
               ) {

                  await interaction.reply({

                     content: '🌸 Momo’s music is already playing ♡',

                     flags: MessageFlags.Ephemeral
                  });

                  return;
               }


               queue.node.setPaused(
                  false
               );


               await interaction.reply({

                  content: '▶️ Momo is playing again ♡',

                  flags: MessageFlags.Ephemeral
               });

               return;
            }


            // ==========================================
            // ⏭ SKIP
            // ==========================================

            if (
               interaction.customId ===
               'momo_skip'
            ) {

               if (
                  !queue.isPlaying()
               ) {

                  await interaction.reply({

                     content: '🌸 Momo isn’t playing anything right now ♡',

                     flags: MessageFlags.Ephemeral
                  });

                  return;
               }


               const currentTrack =
                  queue.currentTrack;


               if (currentTrack) {

                  intentionallyStoppedTracks.set(
                     currentTrack.id,
                     'button'
                  );


                  clearRecoveryState(
                     queue.guild.id
                  );
               }


               // A skip is no longer an idle state.
               // Cancel any old timer before changing
               // the queue.
               clearIdleTimer(
                  queue.guild.id
               );


               queue.node.skip();


               await interaction.reply({

                  content: '⏭️ Momo skipped the song ♡',

                  flags: MessageFlags.Ephemeral
               });


               return;
            }


            // ==========================================
            // ⏹ STOP
            // ==========================================

            if (
               interaction.customId ===
               'momo_stop'
            ) {

               const currentTrack =
                  queue.currentTrack;


               if (currentTrack) {

                  intentionallyStoppedTracks.set(
                     currentTrack.id,
                     'stop'
                  );


                  clearRecoveryState(
                     queue.guild.id
                  );
               }


               // IMPORTANT:
               // Stop means the user intentionally
               // removed Momo, so cancel the timer too.
               clearIdleTimer(
                  queue.guild.id
               );


               queue.delete();


               await interaction.reply({

                  content: '⏹️ Momo stopped the music and cleared her playlist ♡',

                  flags: MessageFlags.Ephemeral
               });

               return;
            }

         } catch (error) {

            console.error(
               '🌸 Momo: Something went wrong with a music button.',
               error
            );


            if (
               !interaction.replied
            ) {

               await interaction
                  .reply({

                     content: '🌸 Momo couldn’t do that just now.\n\n' +
                        '🎀 Please try again in a moment ♡',

                     flags: MessageFlags.Ephemeral

                  })
                  .catch(
                     sendError =>
                     console.error(
                        '🌸 Momo: Could not send button response.',
                        sendError
                     )
                  );
            }
         }


         return;
      }


      // ==================================================
      // 🌸 SLASH COMMANDS
      // ==================================================

      if (
         !interaction.isChatInputCommand()
      ) {

         return;
      }


      const command =
         interaction.commandName;


      try {

         // ==================================================
         // 🌸 HELLO
         // ==================================================

         if (
            command === 'hello'
         ) {

            await safeReply(
               interaction,

               '🌸 **Momo Radio is on air!**\n' +
               '🎶 Momo is ready to bring some music to Cherry Blossom Cafe ♡'
            );

            return;
         }


         // ==================================================
         // 🧪 TEST MP3
         // ==================================================

         if (
            command === 'test'
         ) {

            const voiceChannel =
               getVoiceChannel(
                  interaction
               );


            if (!voiceChannel) {

               await interaction.reply(
                  '🌸 Momo needs you in a voice channel first ♡'
               );

               return;
            }


            await interaction.deferReply();


            const connection =
               joinVoiceChannel({

                  channelId: voiceChannel.id,

                  guildId: interaction.guild.id,

                  adapterCreator: interaction.guild.voiceAdapterCreator
               });


            await entersState(

               connection,

               VoiceConnectionStatus.Ready,

               15000
            );


            const audioPlayer =
               createAudioPlayer();


            const audioPath =
               path.join(
                  __dirname,
                  'test.mp3'
               );


            const resource =
               createAudioResource(
                  audioPath
               );


            connection.subscribe(
               audioPlayer
            );


            audioPlayer.play(
               resource
            );


            await interaction.editReply(
               '🎶 **Momo is playing her little test sound!** ♡'
            );


            audioPlayer.on(
               AudioPlayerStatus.Idle,
               () => {

                  console.log(
                     '🌸 Momo: Her little test sound has finished.'
                  );
               }
            );


            return;
         }


         // ==================================================
         // 🎵 PLAY
         // ==================================================

         if (
            command === 'play'
         ) {

            const voiceChannel =
               getVoiceChannel(
                  interaction
               );


            if (!voiceChannel) {

               await interaction.reply(

                  '🌸 Momo needs you to join a voice channel first ♡\n' +
                  '🎀 Then Momo will know where to play your song!'
               );

               return;
            }


            const query =
               interaction.options
               .getString(
                  'song',
                  true
               )
               .trim();


            await interaction.deferReply();


            // ==================================================
            // 🔗 URL
            // ==================================================

            if (
               looksLikeUrl(query)
            ) {

               // ==============================================
               // 💚 SPOTIFY
               // ==============================================

               if (
                  isSpotifyUrl(query)
               ) {

                  console.log(
                     `🌸 Momo received a Spotify request: ${query}`
                  );


                  const spotifyResult =
                     await player.search(
                        query, {

                           requestedBy: interaction.user,

                           searchEngine: 'spotifySong'
                        }
                     );


                  if (
                     !spotifyResult.hasTracks()
                  ) {

                     await interaction.editReply(

                        '🌸 Momo couldn’t read that Spotify song.\n\n' +
                        '🎀 Try another Spotify track ♡'
                     );

                     return;
                  }


                  const spotifyTrack =
                     spotifyResult.tracks[0];


                  const youtubeQuery =
                     `${spotifyTrack.title} ${spotifyTrack.author}`;


                  console.log(
                     `🌸 Momo is looking for a YouTube version of: ${youtubeQuery}`
                  );


                  const youtubeResult =
                     await player.search(
                        youtubeQuery, {

                           requestedBy: interaction.user,

                           searchEngine: 'youtubeSearch'
                        }
                     );


                  if (
                     !youtubeResult.hasTracks()
                  ) {

                     await interaction.editReply(

                        `🌸 Momo recognized **${spotifyTrack.title}** by ` +
                        `**${spotifyTrack.author}**, ` +
                        `but couldn't find a YouTube version to play.\n\n` +
                        `🎀 Maybe Momo can try another song? ♡`
                     );

                     return;
                  }


                  const tracks =
                     youtubeResult.tracks.slice(
                        0,
                        5
                     );


                  const searchId =
                     `momo_search_${interaction.id}`;


                  pendingSearches.set(
                     searchId, {

                        userId: interaction.user.id,

                        voiceChannelId: voiceChannel.id,

                        tracks
                     }
                  );


                  setTimeout(
                     () => {

                        pendingSearches.delete(
                           searchId
                        );

                     },
                     120000
                  );


                  const row =
                     createSearchMenu(
                        searchId,
                        tracks,
                        '🌸 Choose a YouTube version...'
                     );


                  const embed =
                     new EmbedBuilder()

                     .setColor(
                        MOMO_COLOR
                     )

                     .setAuthor({
                        name: `${MOMO_NAME} • ${MOMO_CAFE}`
                     })

                     .setTitle(
                        '🌸 Momo found your Spotify song!'
                     )

                     .setDescription(

                        `🎧 **Spotify song**\n` +
                        `**${spotifyTrack.title}**\n` +
                        `${spotifyTrack.author || 'Unknown Artist'}\n\n` +

                        `🌸 **Momo found these YouTube versions:**\n\n` +

                        tracks
                        .map(
                           (
                              track,
                              index
                           ) =>

                           `**${index + 1}. ${shorten(track.title, 75)}**\n` +
                           `${shorten(track.author || 'Unknown Artist', 65)} • ` +
                           `${track.duration || 'Unknown'}`
                        )
                        .join(
                           '\n\n'
                        )
                     )

                     .setFooter({
                        text: '🌸 Choose the version Momo should play'
                     });


                  await interaction.editReply({

                     embeds: [embed],

                     components: [row]
                  });


                  return;
               }


               // ==============================================
               // ❤️ YOUTUBE URL
               // ==============================================

               if (
                  isYouTubeUrl(query)
               ) {

                  console.log(
                     `🌸 Momo received a YouTube request: ${query}`
                  );


                  try {

                     const result =
                        await player.play(
                           voiceChannel,
                           query, {

                              requestedBy: interaction.user,

                              nodeOptions: getNodeOptions(
                                 interaction
                              )
                           }
                        );


                     // A song has been successfully added.
                     clearIdleTimer(
                        interaction.guild.id
                     );


                     await interaction.editReply(

                        `🌸 **Momo added the song to her playlist!**\n\n` +
                        `🎶 **${result.track.title}**\n` +
                        `🎧 ${result.track.author || 'Unknown Artist'}\n\n` +
                        `♡ Momo hopes you enjoy it!`
                     );


                  } catch (error) {

                     console.error(
                        '🌸 Momo: YouTube playback could not be started.',
                        error
                     );


                     await interaction.editReply(

                        '🌸 Momo couldn’t play that YouTube video.\n\n' +
                        '🎀 Try another video and Momo will give it a try ♡'
                     );
                  }


                  return;
               }


               // ==============================================
               // 🚫 UNSUPPORTED URL
               // ==============================================

               await interaction.editReply(

                  '🌸 Momo doesn’t know that kind of music link yet ♡\n\n' +
                  '🎶 Momo currently understands:\n' +
                  '• Spotify links\n' +
                  '• YouTube links\n' +
                  '• Song-name searches'
               );


               return;
            }


            // ==================================================
            // 🔎 TEXT SEARCH
            // ==================================================

            console.log(
               `🌸 Momo is searching YouTube for: ${query}`
            );


            const searchResult =
               await player.search(
                  query, {

                     requestedBy: interaction.user,

                     searchEngine: 'youtubeSearch'
                  }
               );


            console.log(
               `🌸 Momo found ${searchResult.tracks.length} possible songs.`
            );


            if (
               !searchResult.hasTracks()
            ) {

               await interaction.editReply(

                  `🌸 Momo couldn’t find anything for **${query}**.\n\n` +
                  `🎀 Maybe try another song title or artist? ♡`
               );

               return;
            }


            const tracks =
               searchResult.tracks.slice(
                  0,
                  5
               );


            const searchId =
               `momo_search_${interaction.id}`;


            pendingSearches.set(
               searchId, {

                  userId: interaction.user.id,

                  voiceChannelId: voiceChannel.id,

                  tracks
               }
            );


            setTimeout(
               () => {

                  pendingSearches.delete(
                     searchId
                  );

               },
               120000
            );


            const row =
               createSearchMenu(
                  searchId,
                  tracks,
                  '🌸 Choose a YouTube result...'
               );


            const embed =
               createSearchEmbed(
                  tracks,
                  '🌸 Momo found these songs!'
               );


            await interaction.editReply({

               embeds: [embed],

               components: [row]
            });


            return;
         }


         // ==================================================
         // 🌸 HELP
         // ==================================================

         if (
            command === 'help'
         ) {

            const embed =
               new EmbedBuilder()

               .setColor(
                  MOMO_COLOR
               )

               .setAuthor({
                  name: `${MOMO_NAME} • ${MOMO_CAFE}`
               })

               .setTitle(
                  '🎀 Momo’s Little Help Menu'
               )

               .setDescription(
                  '🌸 Welcome to the Cherry Blossom Cafe ♡\n\n' +
                  'Here are the little things Momo can do for you!'
               )

               .addFields(

                  {
                     name: '🎵 MUSIC',

                     value: '`/play` — Find and play a song ♡\n' +
                        '`/queue` — Peek at Momo’s little playlist\n' +
                        '`/nowplaying` — See what Momo is playing',

                     inline: false
                  },


                  {
                     name: '🌸 PLAYBACK',

                     value: '`/skip` — Skip the current song\n' +
                        '`/pause` — Tuck the music into a little pause\n' +
                        '`/resume` — Wake the music back up ♡\n' +
                        '`/stop` — Stop the music and clear the playlist\n' +
                        '`/leave` — Ask Momo to leave the voice channel',

                     inline: false
                  },


                  {
                     name: '🎀 QUEUE',

                     value: '`/clear` — Clear all upcoming songs\n' +
                        '`/queue` — See the songs waiting to play',

                     inline: false
                  }

               )

               .setFooter({

                  text: '🌸 Momo Radio • Cherry Blossom Cafe • ♡'
               });


            await interaction.reply({

               embeds: [
                  embed
               ]
            });


            return;
         }


         // ==================================================
         // ⏭ SKIP
         // ==================================================

         if (
            command === 'skip'
         ) {

            const queue =
               getQueue(
                  interaction.guild.id
               );


            if (
               !queue ||
               !queue.isPlaying()
            ) {

               await interaction.reply(
                  '🌸 Momo isn’t playing anything right now ♡'
               );

               return;
            }


            const currentTrack =
               queue.currentTrack;


            if (currentTrack) {

               intentionallyStoppedTracks.set(
                  currentTrack.id,
                  'command'
               );


               clearRecoveryState(
                  queue.guild.id
               );
            }


            // Cancel any existing idle timer before
            // changing the queue.
            clearIdleTimer(
               queue.guild.id
            );


            queue.node.skip();


            await interaction.reply(
               '⏭️ Momo skipped the song ♡'
            );


            return;
         }


         // ==================================================
         // ⏸ PAUSE
         // ==================================================

         if (
            command === 'pause'
         ) {

            const queue =
               getQueue(
                  interaction.guild.id
               );


            if (
               !queue ||
               !queue.isPlaying()
            ) {

               await interaction.reply(
                  '🌸 Momo isn’t playing anything right now ♡'
               );

               return;
            }


            queue.node.setPaused(
               true
            );


            await interaction.reply(
               '⏸️ Momo tucked the music into a little pause ♡'
            );


            return;
         }


         // ==================================================
         // ▶ RESUME
         // ==================================================

         if (
            command === 'resume'
         ) {

            const queue =
               getQueue(
                  interaction.guild.id
               );


            if (
               !queue ||
               !queue.node.isPaused()
            ) {

               await interaction.reply(
                  '🌸 Momo’s music is already playing ♡'
               );

               return;
            }


            queue.node.setPaused(
               false
            );


            await interaction.reply(
               '▶️ Momo is playing again ♡'
            );


            return;
         }


         // ==================================================
         // ⏹ STOP
         // ==================================================

         if (
            command === 'stop'
         ) {

            const queue =
               getQueue(
                  interaction.guild.id
               );


            if (!queue) {

               await interaction.reply(
                  '🌸 Momo isn’t playing anything right now ♡'
               );

               return;
            }


            const currentTrack =
               queue.currentTrack;


            if (currentTrack) {

               intentionallyStoppedTracks.set(
                  currentTrack.id,
                  'stop'
               );


               clearRecoveryState(
                  queue.guild.id
               );
            }


            // IMPORTANT:
            // Stop is intentional, so the idle timer
            // should not survive this action.
            clearIdleTimer(
               queue.guild.id
            );


            queue.delete();


            await interaction.reply(
               '⏹️ Momo stopped the music and cleared her playlist ♡'
            );


            return;
         }


         // ==================================================
         // 👋 LEAVE
         // ==================================================

         if (
            command === 'leave'
         ) {

            const queue =
               getQueue(
                  interaction.guild.id
               );


            if (!queue) {

               await interaction.reply(
                  '🌸 Momo is already having a little break ♡'
               );

               return;
            }


            clearRecoveryState(
               queue.guild.id
            );


            // IMPORTANT:
            // Manual leave should always cancel
            // the idle timer.
            clearIdleTimer(
               queue.guild.id
            );


            queue.delete();


            await interaction.reply(
               '👋 Momo is heading home from the voice channel for now ♡'
            );


            return;
         }


         // ==================================================
         // 📜 QUEUE
         // ==================================================

         if (
            command === 'queue'
         ) {

            const queue =
               getQueue(
                  interaction.guild.id
               );


            // ==================================================
            // 🌸 EMPTY QUEUE
            // ==================================================

            if (!queue) {

               const embed =
                  new EmbedBuilder()

                  .setColor(
                     MOMO_COLOR
                  )

                  .setAuthor({
                     name: `${MOMO_NAME} • ${MOMO_CAFE}`
                  })

                  .setTitle(
                     '🎀 Momo’s Queue'
                  )

                  .setDescription(
                     '🌸 **The playlist is empty.**\n\n' +
                     '🎶 Add a song with `/play` and Momo will take care of the rest ♡'
                  )

                  .setFooter({
                     text: '🌸 Cherry Blossom Cafe'
                  });


               await interaction.reply({

                  embeds: [embed]
               });


               return;
            }


            const current =
               queue.currentTrack;


            const upcoming =
               queue.tracks
               .toArray()
               .slice(
                  0,
                  10
               );


            const totalUpcoming =
               queue.tracks.size;


            const remaining =
               Math.max(
                  0,
                  totalUpcoming -
                  upcoming.length
               );


            // ==================================================
            // 🌸 CURRENT SONG
            // ==================================================

            let currentSection =
               '🌸 Momo isn’t playing anything right now ♡';


            if (current) {

               let progressBar =
                  '';


               try {

                  progressBar =
                     queue.node.createProgressBar();

               } catch (error) {

                  console.warn(
                     '🌸 Momo: Could not create the queue progress bar.',
                     error
                  );
               }


               currentSection =
                  `**${shorten(current.title, 75)}**\n` +
                  `${shorten(
                            current.author ||
                            'Unknown Artist',
                            70
                        )}\n\n`;


               if (progressBar) {

                  currentSection +=
                     `${progressBar}\n`;
               }


               currentSection +=
                  `🎧 Requested by ${
                            current.requestedBy?.toString() ||
                            'a lovely listener'
                        }`;
            }


            // ==================================================
            // 🌸 UP NEXT
            // ==================================================

            let upcomingSection =
               '🌸 Nothing else is waiting in Momo’s playlist ♡';


            if (
               upcoming.length > 0
            ) {

               upcomingSection =

                  upcoming
                  .map(
                     (
                        track,
                        index
                     ) => {

                        const number =
                           getQueueNumber(
                              index
                           );


                        const title =
                           shorten(
                              track.title,
                              65
                           );


                        const artist =
                           shorten(
                              track.author ||
                              'Unknown Artist',
                              55
                           );


                        const duration =
                           track.duration ||
                           'Unknown';


                        return (

                           `${number} **${title}**\n` +
                           `　${artist} • \`${duration}\``
                        );
                     }
                  )
                  .join(
                     '\n\n'
                  );
            }


            // ==================================================
            // 🌸 QUEUE EMBED
            // ==================================================

            const embed =
               new EmbedBuilder()

               .setColor(
                  MOMO_COLOR
               )

               .setAuthor({
                  name: `${MOMO_NAME} • ${MOMO_CAFE}`
               })

               .setTitle(
                  '🎀 Momo’s Queue'
               )

               .setDescription(
                  '🌸 *A little playlist for the cafe ♡*'
               )

               .addFields(

                  {
                     name: '🎶 NOW PLAYING',

                     value: currentSection
                  },

                  {
                     name: `🌸 UP NEXT${
                                        totalUpcoming > 0
                                            ? ` • ${totalUpcoming}`
                                            : ''
                                    }`,

                     value: upcomingSection
                  }
               )

               .setFooter({

                  text: remaining > 0

                     ?
                     `🌸 ${remaining} more song${
                                        remaining === 1
                                            ? ''
                                            : 's'
                                      } waiting • ${MOMO_CAFE}`

                     :
                     `🌸 That’s everything for now • ${MOMO_CAFE}`
               });


            if (
               current &&
               current.thumbnail
            ) {

               embed.setThumbnail(
                  current.thumbnail
               );
            }


            await interaction.reply({

               embeds: [embed]
            });


            return;
         }


         // ==================================================
         // 🎶 NOW PLAYING
         // ==================================================

         if (
            command === 'nowplaying'
         ) {

            const queue =
               getQueue(
                  interaction.guild.id
               );


            if (
               !queue ||
               !queue.currentTrack
            ) {

               await interaction.reply(
                  '🌸 Momo isn’t playing anything right now ♡'
               );

               return;
            }


            const track =
               queue.currentTrack;


            const embed =
               createNowPlayingEmbed(
                  track
               );


            const buttons =
               createPlayerButtons();


            await interaction.reply({

               embeds: [embed],

               components: [buttons]
            });


            return;
         }


         // ==================================================
         // 🗑 CLEAR
         // ==================================================

         if (
            command === 'clear'
         ) {

            const queue =
               getQueue(
                  interaction.guild.id
               );


            if (!queue) {

               await interaction.reply(
                  '🌸 Momo’s playlist is already empty ♡'
               );

               return;
            }


            queue.tracks.clear();


            await interaction.reply(
               '🗑️ Momo cleared all the upcoming songs ♡\n\n🎶 The current song can finish peacefully.'
            );


            // Normally playerFinish will start the idle
            // timer once the current song finishes.
            //
            // This extra check handles the case where
            // there is already no current song.
            setTimeout(
               () => {

                  const currentQueue =
                     getQueue(
                        interaction.guild.id
                     );


                  if (
                     currentQueue &&
                     !currentQueue.currentTrack &&
                     currentQueue.tracks.size === 0
                  ) {

                     startIdleTimer(
                        currentQueue
                     );
                  }

               },
               500
            );


            return;
         }

      } catch (error) {

         // ==================================================
         // 🌸 MOMO'S LAST RESORT
         // ==================================================

         console.error(
            '🌸 Momo: An unexpected command problem occurred.',
            error
         );


         await safeReply(

            interaction,

            '🌸 Momo stumbled over something for a moment.\n\n' +
            '🎀 Please try that again in a little while ♡'
         );
      }
   }
);


// ======================================================
// 🌸 START BOT
// ======================================================

async function startBot() {

   if (
      !process.env.DISCORD_TOKEN
   ) {

      console.error(
         '🌸 Momo cannot wake up because DISCORD_TOKEN is missing from .env'
      );

      process.exit(1);
   }


   try {

      await loadExtractors();


      await client.login(
         process.env.DISCORD_TOKEN
      );


   } catch (error) {

      console.error(
         '🌸 Momo could not wake up properly.',
         error
      );

      process.exit(1);
   }
}


startBot();