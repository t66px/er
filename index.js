require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  InteractionType,
  StringSelectMenuBuilder,
} = require('discord.js');
const fetch = require('node-fetch');
const Enmap = require('enmap');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
});

const urlEnmap = new Enmap({
  name: 'urls',
  autoFetch: true,
  fetchAll: false,
});

const messageEnmap = new Enmap({
  name: 'messages',
  autoFetch: true,
  fetchAll: false,
});

const PREFIX = process.env.PREFIX || '!';
const POLLING_INTERVAL = 60000;
const MAX_URLS_PER_USER = 10;

const ALLOWED_USER_ID = process.env.ALLOWED_USER_ID || '201069715647365120';

const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID || '1389161345240531044';

const loggingEnabled = false;
function customLogger(...message) {
  if (loggingEnabled) {
    console.log(...message);
  }
}

function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

function createUptimeEmbed(totalUrls) {
  const embed = new EmbedBuilder()
    .setTitle('**Pro Hosting Uptimer**')
    .setDescription('قم بإدارة روابط URL المراقبة الخاصة بك باستخدام الأزرار أدناه.')
    .setImage('https://cdn.discordapp.com/attachments/1123320791598108692/1385718205330227321/34347d0dc01b10c90dad4fde08ff7291.webp?ex=68639c65&is=68624ae5&hm=9298d4adef155b2762160c213bf73d7fc850725160815498b12892d5b66e44c0')
    .setColor(0x5865F2)
    .setThumbnail(client.user.displayAvatarURL())
    .addFields(
      { name: '🔗 **إجمالي الروابط**', value: `${totalUrls}`, inline: true },
      { name: '⏱️ **فترة المراقبة**', value: `1 دقيقة`, inline: true },
      { name: '♻️ **الحالة**', value: totalUrls > 0 ? '🟢' : '⚪', inline: true }
    )
    .setTimestamp()
    .setFooter({ text: 'Pro Hosting Uptimer', iconURL: client.user.displayAvatarURL() });

  return embed;
}

/**
 * @param {string} url - عنوان URL للفحص.
 * @param {string} userId - معرف المستخدم الذي يملك عنوان URL.
 */
async function fetchUrl(url, userId) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, 10000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`خطأ HTTP! الحالة: ${response.status}`);
    }

    updateUrlStatus(userId, url, 'online');
    customLogger(`تم فحص ${url} بنجاح للمستخدم ${userId}`);
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(`مهلة الفحص ل${url}`);
    } else {
      console.error(`خطأ في فحص ${url}:`, error.message);
    }
    updateUrlStatus(userId, url, 'offline');
  }
}

/**
 * @param {string} userId - معرف المستخدم.
 * @param {string} url - عنوان URL للتحديث.
 * @param {string} status - الحالة الجديدة ('online' أو 'offline').
 */
function updateUrlStatus(userId, url, status) {
  const userUrls = urlEnmap.get(userId);
  if (!Array.isArray(userUrls)) return;

  const urlIndex = userUrls.findIndex((item) => item.url === url);
  if (urlIndex === -1) return;

  if (status === 'online') {
    if (userUrls[urlIndex].status === 'offline') {
      sendUrlBackOnlineDm(userId, url);
    }
    userUrls[urlIndex].status = 'online';
    userUrls[urlIndex].failureCount = 0;
  } else if (status === 'offline') {
    userUrls[urlIndex].failureCount = (userUrls[urlIndex].failureCount || 0) + 1;
    userUrls[urlIndex].status = 'offline';

    if (userUrls[urlIndex].failureCount === 1) {
      sendUrlDownDm(userId, url);
    }

    if (userUrls[urlIndex].failureCount >= 5) {
      userUrls.splice(urlIndex, 1);
      urlEnmap.set(userId, userUrls);

      sendUrlRemovedDm(userId, url);

      updateMainEmbed();

      sendLogMessage('حذف عنوان URL تلقائيًا بعد 5 محاولات فاشلة', { id: userId }, url, 0xff0000);
    }
  }

  urlEnmap.set(userId, userUrls);
}

/**
 * @param {string} userId - معرف المستخدم.
 * @param {string} url - عنوان URL.
 */
async function sendUrlDownDm(userId, url) {
  try {
    const user = await client.users.fetch(userId);
    if (user) {
      const embed = new EmbedBuilder()
        .setTitle('🔴 **الرابط الخاص بك لا يعمل**')
        .setDescription(`الرابط **${url}** غير متاح حاليًا.`)
        .setColor(0xff0000)
        .setTimestamp();
      await user.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error(`فشل في إرسال رسالة DM إلى المستخدم ${userId}:`, error);
  }
}

/**
 * @param {string} userId - معرف المستخدم.
 * @param {string} url - عنوان URL.
 */
async function sendUrlBackOnlineDm(userId, url) {
  try {
    const user = await client.users.fetch(userId);
    if (user) {
      const embed = new EmbedBuilder()
        .setTitle('🟢 **الرابط الخاص بك عاد للعمل**')
        .setDescription(`الرابط **${url}** متاح الآن مرة أخرى.`)
        .setColor(0x00ff00)
        .setTimestamp();
      await user.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error(`فشل في إرسال رسالة DM إلى المستخدم ${userId}:`, error);
  }
}

/**
 * @param {string} userId - معرف المستخدم.
 * @param {string} url - عنوان URL.
 */
async function sendUrlRemovedDm(userId, url) {
  try {
    const user = await client.users.fetch(userId);
    if (user) {
      const embed = new EmbedBuilder()
        .setTitle('⚠️ **تم إزالة الرابط من المراقبة**')
        .setDescription(`تمت إزالة الرابط **${url}** من المراقبة بعد 5 محاولات فاشلة متتالية.`)
        .setColor(0xffa500)
        .setTimestamp();
      await user.send({ embeds: [embed] });
    }
  } catch (error) {
    console.error(`فشل في إرسال رسالة DM إلى المستخدم ${userId}:`, error);
  }
}

const urlQueue = [];
let isProcessingQueue = false;

function enqueueUrls() {
  const users = urlEnmap.keyArray();
  users.forEach((userId) => {
    const userUrls = urlEnmap.get(userId);
    if (Array.isArray(userUrls)) {
      userUrls.forEach((item) => {
        urlQueue.push({ url: item.url, userId });
      });
    }
  });
}

async function processUrlQueue() {
  if (isProcessingQueue || urlQueue.length === 0) return;
  isProcessingQueue = true;

  while (urlQueue.length > 0) {
    const { url, userId } = urlQueue.shift();
    await fetchUrl(url, userId);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  isProcessingQueue = false;
}

setInterval(() => {
  enqueueUrls();
  processUrlQueue();
}, POLLING_INTERVAL);

client.once('ready', () => {
  console.log(`Bot is Ready as ${client.user.tag}!`);
  console.log(`Code by Peno`);
  console.log(`discord.gg/7`);
  enqueueUrls();
  processUrlQueue();
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'uptime') {
    if (message.author.id !== ALLOWED_USER_ID) return;
    await handleUptimeCommand(message);
  }
});

/**
 * @param {Message} message - رسالة Discord.
 */
async function handleUptimeCommand(message) {
  try {
    const users = urlEnmap.keyArray();
    let totalUrls = 0;
    users.forEach((userId) => {
      const userUrls = urlEnmap.get(userId);
      if (Array.isArray(userUrls)) {
        totalUrls += userUrls.length;
      }
    });

    const embed = createUptimeEmbed(totalUrls);

    const addButton = new ButtonBuilder()
      .setCustomId('add_url')
      .setLabel('➕ إضافة عنوان URL')
      .setStyle(ButtonStyle.Success);

    const deleteButton = new ButtonBuilder()
      .setCustomId('delete_url')
      .setLabel('➖ حذف عنوان URL')
      .setStyle(ButtonStyle.Danger);

    const listButton = new ButtonBuilder()
      .setCustomId('list_urls')
      .setLabel('📋 قائمة عناوين URL')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(addButton, deleteButton, listButton);

    const sentMessage = await message.channel.send({ embeds: [embed], components: [row] });

    messageEnmap.set(message.author.id, { channelId: message.channel.id, messageId: sentMessage.id });
  } catch (error) {
    console.error('خطأ في handleUptimeCommand:', error);
    const embed = new EmbedBuilder()
      .setTitle('⚠️ **خطأ**')
      .setDescription('فشل عرض واجهة مراقبة التوافر.')
      .setColor(0xff0000)
      .setTimestamp();
    await message.channel.send({ embeds: [embed] });
  }
}

/**
 * @param {Interaction} interaction - تفاعل Discord.
 */
async function handleModalSubmit(interaction) {
  try {
    const userId = interaction.user.id;
    const url = interaction.fields.getTextInputValue('url_input').trim();

    if (!isValidUrl(url)) {
      const embed = new EmbedBuilder()
        .setTitle('❌ **عنوان URL غير صالح**')
        .setDescription('يرجى تقديم عنوان URL صالح. مثال: `https://glitch.com/@X1`')
        .setColor(0xffa500)
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    let userUrls = urlEnmap.get(userId);
    if (!Array.isArray(userUrls)) {
      userUrls = [];
    }

    if (userUrls.length >= MAX_URLS_PER_USER) {
      const embed = new EmbedBuilder()
        .setTitle('🚫 **تم الوصول إلى الحد الأقصى**')
        .setDescription(`لقد وصلت إلى الحد الأقصى من ${MAX_URLS_PER_USER} عنوان URL للمراقبة.`)
        .setColor(0xff0000)
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (userUrls.find((item) => item.url === url)) {
      const embed = new EmbedBuilder()
        .setTitle('🔁 **عنوان URL موجود بالفعل**')
        .setDescription('عنوان URL هذا موجود بالفعل في قائمة المراقبة الخاصة بك.')
        .setColor(0xffa500)
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    userUrls.push({ url, status: 'unknown', failureCount: 0 });
    urlEnmap.set(userId, userUrls);

    const embed = new EmbedBuilder()
      .setTitle('✅ **تم إضافة عنوان URL**')
      .setDescription(`تم إضافة عنوان URL **${url}** إلى قائمة المراقبة الخاصة بك.`)
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });

    urlQueue.push({ url, userId });

    await updateMainEmbed();

    await sendLogMessage('إضافة عنوان URL', interaction.user, url, 0x00ff00);
  } catch (error) {
    console.error('خطأ في handleModalSubmit:', error);
    const embed = new EmbedBuilder()
      .setTitle('⚠️ **خطأ**')
      .setDescription('حدث خطأ أثناء إضافة عنوان URL الخاص بك. يرجى المحاولة مرة أخرى.')
      .setColor(0xff0000)
      .setTimestamp();
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

/**
 * @param {Interaction} interaction - تفاعل Discord.
 */
async function handleSelectMenu(interaction) {
  try {
    const userId = interaction.user.id;
    const selectedUrl = interaction.values[0];

    let userUrls = urlEnmap.get(userId);
    if (!Array.isArray(userUrls)) {
      userUrls = [];
    }

    if (!userUrls.find((item) => item.url === selectedUrl)) {
      const embed = new EmbedBuilder()
        .setTitle('❌ **عنوان URL غير موجود**')
        .setDescription('عنوان URL المحدد غير موجود في قائمة المراقبة الخاصة بك.')
        .setColor(0xff0000)
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    userUrls = userUrls.filter((item) => item.url !== selectedUrl);
    urlEnmap.set(userId, userUrls);

    const embed = new EmbedBuilder()
      .setTitle('✅ **تم حذف عنوان URL**')
      .setDescription(`تم حذف عنوان URL **${selectedUrl}** من قائمة المراقبة الخاصة بك.`)
      .setColor(0x00ff00)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });

    await updateMainEmbed();

    await sendLogMessage('حذف عنوان URL', interaction.user, selectedUrl, 0xff0000);
  } catch (error) {
    console.error('خطأ في handleSelectMenu:', error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'حدث خطأ أثناء معالجة طلبك.',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: 'حدث خطأ أثناء معالجة طلبك.',
        ephemeral: true,
      });
    }
  }
}

/**
 * @param {Interaction} interaction - تفاعل Discord.
 */
async function handleListUrls(interaction) {
  try {
    const userId = interaction.user.id;
    const userUrls = urlEnmap.get(userId) || [];

    if (!Array.isArray(userUrls) || userUrls.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('📋 **عناوين URL المراقبة الخاصة بك**')
        .setDescription('لا توجد عناوين URL تتم مراقبتها.')
        .setColor(0xffa500)
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const urlList = userUrls
      .map((item, index) => {
        const statusEmoji = item.status === 'online' ? '🟢' : item.status === 'offline' ? '🔴' : '⚪';
        return `${index + 1}. ${statusEmoji} **${item.url}** (محاولات فاشلة: ${item.failureCount || 0})`;
      })
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle('📋 **عناوين URL المراقبة الخاصة بك**')
      .setDescription(urlList)
      .setColor(0x5865F2)
      .setTimestamp()
      .setFooter({ text: 'Pro Hosting Uptimer', iconURL: client.user.displayAvatarURL() });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  } catch (error) {
    console.error('خطأ في handleListUrls:', error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'حدث خطأ أثناء معالجة طلبك.',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: 'حدث خطأ أثناء معالجة طلبك.',
        ephemeral: true,
      });
    }
  }
}

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton()) {
      const { customId } = interaction;

      if (customId === 'add_url') {
        const modal = new ModalBuilder()
          .setCustomId('add_url_modal')
          .setTitle('📥 إضافة عنوان URL للمراقبة');

        const urlInput = new TextInputBuilder()
          .setCustomId('url_input')
          .setLabel('أدخل عنوان URL الذي تريد مراقبته')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('https://glitch.com/@X1')
          .setRequired(true);

        const firstActionRow = new ActionRowBuilder().addComponents(urlInput);
        modal.addComponents(firstActionRow);

        await interaction.showModal(modal);
      } else if (customId === 'delete_url') {
        const userId = interaction.user.id;
        const userUrls = urlEnmap.get(userId) || [];

        if (!Array.isArray(userUrls) || userUrls.length === 0) {
          const embed = new EmbedBuilder()
            .setTitle('❌ **لا توجد عناوين URL للحذف**')
            .setDescription('لا توجد عناوين URL لحذفها في قائمة المراقبة الخاصة بك.')
            .setColor(0xffa500)
            .setTimestamp();
          return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('delete_url_select')
          .setPlaceholder('اختر عنوان URL لحذفه')
          .addOptions(
            userUrls.map((item) => ({
              label: item.url.length > 50 ? `${item.url.substring(0, 47)}...` : item.url,
              value: item.url,
            }))
          );

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
          .setTitle('🗑️ **حذف عنوان URL**')
          .setDescription('يرجى اختيار عنوان URL الذي تريد حذفه من القائمة أدناه.')
          .setColor(0xff0000)
          .setTimestamp();

        await interaction.reply({
          embeds: [embed],
          components: [row],
          ephemeral: true,
        });
      } else if (customId === 'list_urls') {
        await handleListUrls(interaction);
      }
    } else if (interaction.type === InteractionType.ModalSubmit) {
      if (interaction.customId === 'add_url_modal') {
        await handleModalSubmit(interaction);
      }
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'delete_url_select') {
        await handleSelectMenu(interaction);
      }
    }
  } catch (error) {
    console.error('خطأ في التعامل مع التفاعل:', error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: 'حدث خطأ أثناء معالجة طلبك.',
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: 'حدث خطأ أثناء معالجة طلبك.',
        ephemeral: true,
      });
    }
  }
});

async function updateMainEmbed() {
  try {
    const users = urlEnmap.keyArray();
    let totalUrls = 0;
    users.forEach((userId) => {
      const userUrls = urlEnmap.get(userId);
      if (Array.isArray(userUrls)) {
        totalUrls += userUrls.length;
      }
    });

    const allMessages = messageEnmap.entries();
    for (const [userId, messageData] of allMessages) {
      try {
        const channel = await client.channels.fetch(messageData.channelId);
        const message = await channel.messages.fetch(messageData.messageId);
        if (message) {
          const updatedEmbed = createUptimeEmbed(totalUrls);
          await message.edit({ embeds: [updatedEmbed] });
        } else {
          console.warn(`الرسالة ذات المعرّف ${messageData.messageId} غير موجودة في القناة ${messageData.channelId}.`);
          messageEnmap.delete(userId);
        }
      } catch (err) {
        console.error('خطأ في جلب أو تعديل الرسالة:', err);
      }
    }
  } catch (error) {
    console.error('خطأ في تحديث الـ Embed الرئيسي:', error);
  }
}

/**
 * @param {string} action - الإجراء (إضافة أو حذف)
 * @param {User} user - المستخدم الذي قام بالإجراء
 * @param {string} url - عنوان URL المعني
 * @param {number} color - لون الـ Embed
 */
async function sendLogMessage(action, user, url, color) {
  try {
    const logChannel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (logChannel) {
      const logEmbed = new EmbedBuilder()
        .setColor(color)
        .setAuthor({ name: `${user.tag || user.id} (${user.id})`, iconURL: user.displayAvatarURL ? user.displayAvatarURL() : null })
        .setTitle(`🔔 ${action}`)
        .addFields(
          { name: '🔗 عنوان URL', value: url },
          { name: '👤 المستخدم', value: `<@${user.id}>` },
          { name: '🆔 معرف المستخدم', value: user.id }
        )
        .setThumbnail(user.displayAvatarURL ? user.displayAvatarURL() : null)
        .setTimestamp()
        .setFooter({ text: 'Pro Hosting Uptimer', iconURL: client.user.displayAvatarURL() });

      await logChannel.send({ embeds: [logEmbed] });
    } else {
      console.warn('قناة السجل غير موجودة.');
    }
  } catch (logError) {
    console.error('خطأ في إرسال رسالة السجل:', logError);
  }
}

client.login(process.env.TOKEN).catch((error) => {
  console.error('فشل تسجيل الدخول:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, p) => {
  console.log(' [antiCrash] :: Unhandled Rejection/Catch');
  console.log(reason, p);
});
process.on("uncaughtException", (err, origin) => {
  console.log(' [antiCrash] :: Uncaught Exception/Catch');
  console.log(err, origin);
});
process.on('uncaughtExceptionMonitor', (err, origin) => {
  console.log(' [antiCrash] :: Uncaught Exception/Catch (MONITOR)');
  console.log(err, origin);
});
