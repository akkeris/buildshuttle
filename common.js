const request = require("request");
let kafka = require("kafka-node");
const DockerOde = require("dockerode");
const docker = new DockerOde({socketPath: "/var/run/docker.sock"});
const aws = require("aws-sdk");
const fs = require("fs");

if(process.env.TEST_MODE) {
  kafka = require("./test/support/kafka-mock.js");
}

let logStreams = {};
let logIntervals = {};
let producers = {};

async function haveObject(Key) {
  if(process.env.TEST_MODE) {
    let destFile = `/tmp/archives/${Key}`;
    return fs.existsSync(destFile) ? true : false;
  }
  try {
    await (new aws.S3({accessKeyId:process.env.S3_ACCESS_KEY, secretAccessKey:process.env.S3_SECRET_KEY}))
      .headObject({Bucket:process.env.S3_BUCKET, Key})
      .promise();
    return true;
  } catch (e) {
    return false
  }
}

async function getObject(Key) {
  if(process.env.TEST_MODE) {
    let destFile = `/tmp/archives/${Key}`;
    return fs.createReadStream(destFile);
  }
  return await (new aws.S3({accessKeyId:process.env.S3_ACCESS_KEY, secretAccessKey:process.env.S3_SECRET_KEY}))
    .getObject({ Bucket:process.env.S3_BUCKET, Key})
    .createReadStream();
}

async function putObject(Key, Body) {
  if(process.env.TEST_MODE) {
    let destFile = `/tmp/archives/${Key}`;
    let o = fs.createWriteStream(destFile);
    if(Body.pipe) {
      Body.pipe(o);
    } else {
      o.write(Body);
    }
    o.end();
    return
  }
  return await (new aws.S3({accessKeyId:process.env.S3_ACCESS_KEY, secretAccessKey:process.env.S3_SECRET_KEY}))
    .putObject({ Bucket:process.env.S3_BUCKET, Key, ACL:"authenticated-read", ContentType:"application/octet-stream", Body})
    .promise();
}

async function follow(stream, onProgress) {
  return new Promise((resolve, reject) => docker.modem.followProgress(stream, (err, output) => err ? reject(err) : resolve(output), onProgress));
}

function eventLogMessage(event) {
  let message = [event.status, event.progress, event.stream].filter((x) => !!x).reduce((a, arg) => `${a} ${arg}`, '').trim();
  if(message !== '') {
    message = `${message}\n`;
  }
  return message;
}

function checkQueue(kafkaHost) {
  if(!producers[kafkaHost]) {
    console.error(`Error, we started checking a queue that doesnt exist: ${kafkaHost}`);
    return;
  }
  if(producers[kafkaHost].queue.length > 0) {
    let messages = producers[kafkaHost].queue.map((x) => {
      return JSON.stringify({
        "metadata":`${x.app}-${x.space}`, 
        "build":x.build, 
        "job":x.build,
        "message":eventLogMessage(x.event),
      });
    });
    producers[kafkaHost].producer.send({"topic":"alamoweblogs", messages}, (err) => { 
      if(err) {
        console.error(`Unable to send traffic to kafka:\n${$err}`);
      }
    })
    producers[kafkaHost].queue = [];
  }
  setTimeout(checkQueue.bind(null, kafkaHost), 2000);
}

function getKafkaSendingQueue(kafkaHost) {
  if (!kafkaHost) {
    return {queue:[]}; // return a dummy queue.
  }
  if ( !producers[kafkaHost] ) {
    producers[kafkaHost] = { producer:new kafka.Producer(new kafka.KafkaClient({kafkaHost})), queue:[] };
    producers[kafkaHost].producer.on("ready", checkQueue.bind(null, kafkaHost));
  }
  return producers[kafkaHost];
}

async function flushLogsToS3(payload) {
  let build_uuid = payload.build_uuid;
  if(logStreams[build_uuid]) {
    putObject(`${payload.app}-${payload.app_uuid}-${payload.build_number}.logs`, logStreams[build_uuid]);
  }
  logIntervals[build_uuid] = null;
}

async function sendLogsToS3(payload, event) {
  if(!payload.build_uuid) {
    return console.error("Unable to send logs to s3, blank build_uuid sent.");
  }
  if(!logIntervals[payload.build_uuid]) {
    logIntervals[payload.build_uuid] = setTimeout(flushLogsToS3.bind(null, payload), 2000);
  }
  if(!logStreams[payload.build_uuid] && logStreams[payload.build_uuid] !== "") {
    logStreams[payload.build_uuid] = "";
  }
  logStreams[payload.build_uuid] += eventLogMessage(event);
}

async function sendLogsToKafka(kafkaHost, type, app, space, build, event) {
  getKafkaSendingQueue(kafkaHost).queue.push({ type, app, space, build, event });
}

async function sendLogs(payload, type, event) {
  if(event.stream) {
    event.stream = event.stream.toString().replace(/^[\n]+|[\n]+$/g, "");
  }
  if(event.status) {
    event.status = event.status.toString().replace(/^[\n]+|[\n]+$/g, "");
  }
  if(event.progress) {
    event.progress = event.progress.toString().replace(/^[\n]+|[\n]+$/g, "");
  }
  event.type = type;
  sendLogsToKafka(payload.kafka_hosts, event.type, payload.app, payload.space, payload.build_number, event);
  sendLogsToS3(payload, event);
}

async function closeLogs(payload) {
  if(logIntervals[payload.build_uuid]) {
    clearInterval(logIntervals[payload.build_uuid]);
  }
  if(logStreams[payload.build_uuid]) {
     flushLogsToS3(payload);
  }
  logStreams[payload.build_uuid] = null;
  logIntervals[payload.build_uuid] = null;
}

async function sendStatus(url, authorization, id, status, building) {
  try {
    if(url) {
      request({url, headers:{authorization, "content-type":"application/json"}, method:"post", body:JSON.stringify({id, status, building, "type":"buildshuttle"})});
    }
  } catch (e) {
    console.error(`Unable to send callback status to ${url}`);
    console.error(e);
  }
}

function log(...args) {
  if(process.env.TEST_MODE) {
    console.log("    -", ...args);
  } else {
    console.log(...args);
  }
}

module.exports = {
  log,
  haveObject,
  getObject,
  putObject,
  sendStatus,
  sendLogs,
  sendLogsToKafka,
  closeLogs,
  sendLogsToS3,
  follow,
};