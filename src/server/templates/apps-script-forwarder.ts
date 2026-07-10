/**
 * Generates the Google Apps Script forwarder a user installs in their OWN
 * Google account (ADR 1). State lives in a Gmail label, so the script is
 * stateless and retries are automatic: a thread is labelled only after a 2xx.
 * ShiftSync holds no Gmail credentials at any point.
 */
export function buildAppsScriptForwarder(input: {
  endpoint: string;
  connectionId: string;
  keyHex: string;
}): string {
  return `// ShiftSync mailbox forwarder — runs in YOUR Google account.
// Setup: script.google.com → New project → paste this file → run setup() once
// (grant permissions when asked). It then checks for new matching mail every
// minute and pushes it to your ShiftSync instance, signed.

var ENDPOINT = '${input.endpoint}';
var CONNECTION_ID = '${input.connectionId}';
var KEY_HEX = '${input.keyHex}';
// Adjust to match your employer's rota/payslip senders:
var GMAIL_QUERY = 'newer_than:7d (from:tracsis.com OR subject:rota OR subject:payslip)';
var SYNCED_LABEL = 'ShiftSync/Synced';

function setup() {
  ScriptApp.newTrigger('forwardNewMail').timeBased().everyMinutes(1).create();
  GmailApp.createLabel(SYNCED_LABEL);
  forwardNewMail();
}

function forwardNewMail() {
  var label = GmailApp.getUserLabelByName(SYNCED_LABEL) || GmailApp.createLabel(SYNCED_LABEL);
  var threads = GmailApp.search(GMAIL_QUERY + ' -label:' + SYNCED_LABEL.replace('/', '-'));
  // Gmail search can't always match nested labels; re-check per message below.
  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    if (threadHasLabel_(thread, SYNCED_LABEL)) continue;
    var messages = thread.getMessages();
    var allOk = true;
    for (var m = 0; m < messages.length; m++) {
      if (!pushMessage_(messages[m])) allOk = false;
    }
    if (allOk) thread.addLabel(label);
  }
}

function threadHasLabel_(thread, name) {
  var labels = thread.getLabels();
  for (var i = 0; i < labels.length; i++) if (labels[i].getName() === name) return true;
  return false;
}

function pushMessage_(message) {
  var attachments = message.getAttachments({ includeInlineImages: false });
  var attachmentPayload = [];
  var budget = 3000000; // stay under the endpoint's body cap
  for (var i = 0; i < attachments.length && i < 10; i++) {
    var bytes = attachments[i].getBytes();
    if (bytes.length > budget) continue;
    budget -= bytes.length;
    attachmentPayload.push({
      filename: attachments[i].getName(),
      mimeType: attachments[i].getContentType(),
      contentBase64: Utilities.base64Encode(bytes),
    });
  }
  var raw = message.getRawContent();
  var body = JSON.stringify({
    connectionId: CONNECTION_ID,
    message: {
      providerMessageId: message.getId(),
      receivedAt: message.getDate().toISOString(),
      subject: message.getSubject() || '(no subject)',
      fromAddress: extractAddress_(message.getFrom()),
      plaintextBody: truncate_(message.getPlainBody(), 400000),
      htmlBody: null,
      rawMimeBase64: raw.length < budget ? Utilities.base64Encode(raw, Utilities.Charset.UTF_8) : null,
      attachments: attachmentPayload,
    },
  });
  var timestamp = Math.floor(Date.now() / 1000).toString();
  var signature = toHex_(
    Utilities.computeHmacSha256Signature(
      Utilities.newBlob(timestamp + '.' + body).getBytes(),
      hexToBytes_(KEY_HEX)
    )
  );
  var response = UrlFetchApp.fetch(ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    payload: body,
    muteHttpExceptions: true,
    headers: {
      'x-shiftsync-timestamp': timestamp,
      'x-shiftsync-signature': signature,
    },
  });
  var code = response.getResponseCode();
  return code >= 200 && code < 300;
}

function extractAddress_(from) {
  var match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

function truncate_(s, n) {
  return s && s.length > n ? s.substring(0, n) : s;
}

function toHex_(bytes) {
  return bytes
    .map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('');
}

function hexToBytes_(hex) {
  var bytes = [];
  for (var i = 0; i < hex.length; i += 2) {
    var v = parseInt(hex.substr(i, 2), 16);
    bytes.push(v > 127 ? v - 256 : v);
  }
  return bytes;
}
`;
}
