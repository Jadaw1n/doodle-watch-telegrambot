const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');
const jsonfile = require('jsonfile');
const request = require('request');
const url = require('url');
const _ = require('lodash');

const bot = new TelegramBot(process.env.APIKEY, { polling: true });

// read data on startup
const dataFile = "data.json";
const data = jsonfile.readFileSync(dataFile, { flag: 'r' });

if (data.polls === undefined) data.polls = {};

const extractDataFromBody = (body) => {
  const pollPart = body.match(/\$.extend\(true, doodleJS.data, (.*)\);/);
  if (pollPart === null) return;
  return JSON.parse(pollPart[1]).poll;
};

// save data every second
setInterval(() => {
  jsonfile.writeFile(dataFile, data, (err) => {
    if (err) console.error("Error writing JSON file!", err);
  });
}, 1000);

bot.onText(/^\/newdoodle (.+)$/, (msg, match) => {
  const chatId = msg.chat.id;
  const fromId = msg.from.id;

  // validate url
  const url = match[1];

  if (url === undefined) return; // todo print error to user
  const valid = url.match(/^(https?:\/\/doodle.com\/poll\/[A-Za-z0-9]+)/);
  if (valid === null) return;
  const finalUrl = valid[1];

  if (data.polls[finalUrl] === undefined) {
    // validate poll
    request(finalUrl, (error, res, body) => {
      if (error !== null) return;
      if (res.statusCode !== 200) return;

      data.polls[finalUrl] = {
        notifyChats: [chatId],
        lastCheck: Date.now(), // time in ms,
        data: extractDataFromBody(body)
      };

      bot.sendMessage(chatId, "Successfully subscribed to doodle poll!");
    }).on('error', (e) => {
      console.log(`/newdoodle: Got error: ${e.message}`);
    });
  } else {
    data.polls[finalUrl].notifyChats.push(chatId);

    bot.sendMessage(chatId, "Successfully subscribed to doodle poll!");
  }
});

bot.onText(/^\/removedoodle (.+)$/, (msg, match) => {
  const chatId = msg.chat.id;
  const fromId = msg.from.id;

  const url = match[1];

  const poll = data.polls[url];

  if (poll === undefined) return;

  _.remove(poll.notifyChats, theChatId => theChatId === chatId);

  if (poll.notifyChats.length === 0) delete data.polls[url];

  bot.sendMessage(chatId, "Removed poll!");
});

const pollOptionTokens = {
  'y': 'Yes',
  'n': 'No',
  'i': 'If-Need-Be'
};

// poll check loop
setInterval(() => {
  for (const url in data.polls) {
    const element = data.polls[url];
    const poll = element.data;

    // only check every 5 minutes
    if (Date.now() - 5 * 60 * 1000 < element.lastCheck) continue;

    request(url, (error, res, body) => {
      if (error !== null) return console.log('error in periodic check:'), console.log(error);
      if (res.statusCode !== 200) return console.log('error in periodic check statuscode:'), console.log(res.statusCode);

      const pollData = extractDataFromBody(body);

      const existingVotes = _.keyBy(poll.participants, 'id');
      const newVotes = _.keyBy(pollData.participants, 'id');

      const existingIds = Object.keys(existingVotes);
      const newIds = Object.keys(newVotes);

      let message = `Doodle Poll update [${pollData.title}](${url}):\n`;
      const addedVotes = _.map(_.difference(newIds, existingIds), id => newVotes[id]);
      if (addedVotes.length > 0) message += "New participants:\n " + addedVotes.map(vote => `${vote.name} (${vote.preferences})`).join('\n ') + "\n";

      const removedVotes = _.map(_.difference(existingIds, newIds), id => existingVotes[id]);
      if (removedVotes.length > 0) message += "Removed participants: " + removedVotes.map(vote => vote.name).join(', ') + "\n";

      const maybeChangedIds = _.intersection(newIds, existingIds);
      const maybeChangedVotes = _.map(maybeChangedIds, (id) => ([newVotes[id], existingVotes[id]]));
      const changedVotes = _.filter(maybeChangedVotes, (votePair) => votePair[0].preferences !== votePair[1].preferences);

      if (changedVotes.length > 0) {
        message += "Changed votes: \n" + changedVotes.map(([newVote, oldVote]) => {
          const changedDates = newVote.preferences.split('').map((elm, idx) => oldVote.preferences.split('')[idx] === elm ? null : [elm, idx]).filter(val => val !== null);
          const changedText = changedDates.map(([elm, idx]) => `  ${pollData.optionsText[idx]}: *${pollOptionTokens[elm]}*`).join('\n');
          return ` ${newVote.name} (${newVote.preferences}): \n${changedText}`;
        }).join("\n");
      }

      data.polls[url].data = pollData;
      data.polls[url].lastCheck = Date.now();

      if (removedVotes.length + addedVotes.length + changedVotes.length > 0) {
        element.notifyChats.forEach(chatId => {
          bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
        });
      } else {
        console.log("no change in poll: " + url);
      }
    });
  }
}, 10 * 1000);

// TODO list:
// - send helpful error messages
// - detect changes of options
// - send help message on /start, /help
// - escape all data coming from the poll
// - check if poll closed (remove it and send close message)
// - documentation
// - env variables for all the things (or a settings.json)

console.log("Bot started!");