const fs = require("fs");
const common = require("./common.js");
const debug = require("debug")("buildshuttle-worker");
const stream = require("stream");

let kafka = require("kafka-node");
if(process.env.TEST_MODE) {
  console.log("Running in test mode (using test kafka broker)");
  kafka = require("./test/support/kafka-mock.js");
}

class Logs extends stream.Writable {

  constructor(kafkaHost, app, app_uuid, space, build_uuid, build_number) {
    super();
    this.kafkaHost = kafkaHost;
    this.app = app;
    this.app_uuid = app_uuid;
    this.space = space;
    this.build_uuid = build_uuid;
    this.build_number = build_number;
    this._open = false;
    this.kafkaConnection = null;
    this.logInterval = null;
    this.logStream = "";
  }

  _write(chunk, enc, next) {
    if(!this._open) {
      this.open().then(() => {
        this.send({"stream":chunk.toString()}).then(next).catch((e) => {
          console.log(`Error sending stream: ${e.message}\n${e.stack}`);
        });
      }).catch((e) => {
        console.log(`Error writing stream: ${e.message}\n${e.stack}`);
      });
    }
    this.send({"stream":chunk.toString()}).then(next).catch((e) => {
      console.log(`Error sending stream: ${e.message}\n${e.stack}`);
    });
  }

  eventLogMessage(event) {
    let message = [event.status, event.progress, event.stream].filter((x) => !!x).reduce((a, arg) => `${a} ${arg}`, "").trim();
    if(message !== "") {
      message = `${message}\n`;
    }
    return message;
  }

  open() {
    if(this._open) {
      return new Promise((res) => res);
    }
    debug("opening logging end points");
    return new Promise((resolve, reject) => {
      try {
        if(this.kafkaHost) {
          debug(`connecting to kafka on ${this.kafkaHost}`);
          this.kafkaConnection = new kafka.Producer(new kafka.KafkaClient({kafkaHost:this.kafkaHost}), {"requireAcks":0});
          this.kafkaConnection.on("ready", () => {
            debug(`connected to kafka on ${this.kafkaHost}`);
            this._open = true;
            resolve();
          });
          this.kafkaConnection.on("error", (e) => {
            this._open = false;
            console.log(`A kafka error occured: ${e.message}\n${e.stack}`);
            process.exit(1);
          });
        } else {
          this._open = true;
          debug("kafka was not provided, not streaming logs");
          resolve();
        }
      } catch (e) {
        this._open = false;
        console.log(e);
        reject(e);
      }
    });
  }

  sendLogsToKafka(event) {
    return new Promise((resolve, reject) => {
      if(this.kafkaConnection) {
        let msgs = this.eventLogMessage(event).trim().split("\n").map((x) => {
          if (process.env.SHOW_BUILD_LOGS) {
            console.log(x);
          }
          return {"topic":(process.env.KAFKA_TOPIC || "alamobuildlogs"), "messages":[JSON.stringify({
            "metadata":`${this.app}-${this.space}`, 
            "build":this.build_number, 
            "job":this.build_number.toString(),
            "message":x,
          })]};
        });
        this.kafkaConnection.send(msgs, (err) => {
            if(err) {
              console.log(`Unable to send traffic to kafka: ${err.message}\n${err.stack}`);
              process.exit(1);
            }
            resolve();
        });
      } else {
        if (process.env.SHOW_BUILD_LOGS) {
          this.eventLogMessage(event).trim().split("\n").map((x) => console.log(x));
        }
        resolve();
      }
    });
  }

  async flushLogsToS3() {
    try { 
      if(this.logInterval) {
        clearInterval(this.logInterval);
      }
      this.logInterval = null;
      if(this.logStream) {
        await common.putObject(`${this.app}-${this.app_uuid}-${this.build_number}.logs`, this.logStream);
      }
    } catch (e) {
      console.log(`Error, unable to flush logs: ${e.message}\n${e.stack}`);
    }
  }

  async sendLogsToS3(event) {
    if(!this.logInterval) {
      this.logInterval = setTimeout(this.flushLogsToS3.bind(this), 3000);
    }
    this.logStream += this.eventLogMessage(event);
  }

  async close() {
    debug(`closing and flushing logs for ${this.build_uuid}`);
    await this.flushLogsToS3();
    debug(`flushed s3 logs for ${this.build_uuid}`);
    await this.sendLogsToKafka({"stream":"Build finished"});
    debug(`flushed kafka logs for ${this.build_uuid}`);
  }

  async send(payload, type, event) {
    try {
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
      await this.sendLogsToKafka(event);
      await this.sendLogsToS3(event);
    } catch (e) {
      console.log(`Error sending logs ${e.message}\n${e.stack}`);
    }
  }
}

module.exports = Logs;
