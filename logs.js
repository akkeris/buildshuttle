const assert = require('assert');
const debug = require('debug')('buildshuttle-logging');
const stream = require('stream');
let kafka = require('kafka-node');

const common = require('./common.js');

if (process.env.TEST_MODE) {
  console.log('Running in test mode (using test kafka broker)');
  kafka = require('./test/support/kafka-mock.js'); // eslint-disable-line
}

class Logs extends stream.Writable {
  constructor(kafkaHost, app, appUUID, space, buildUUID, buildNumber) {
    super();
    this.kafkaHost = kafkaHost;
    this.app = app;
    this.app_uuid = appUUID;
    this.space = space;
    this.build_uuid = buildUUID;
    this.build_number = buildNumber;
    this._open = false;
    this.kafkaConnection = null;
    this.logInterval = null;
    this.logStream = '';
  }

  _write(chunk, enc, next) {
    debug('logs._write called');
    assert.ok(this._open, 'The stream is not yet open.');
    this.send(chunk.toString()).then(next).catch((e) => {
      console.log(`Error sending stream: ${e.message}\n${e.stack}`);
    });
  }

  open() {
    if (this._open) {
      return new Promise((res) => res);
    }
    debug('opening logging end points');
    return new Promise((resolve, reject) => {
      try {
        if (this.kafkaHost) {
          debug(`connecting to kafka on ${this.kafkaHost}`);
          this.kafkaConnection = new kafka.Producer(
            new kafka.KafkaClient({ kafkaHost: this.kafkaHost }), { requireAcks: 0 },
          );
          this.kafkaConnection.on('ready', () => {
            debug(`connected to kafka on ${this.kafkaHost}`);
            this._open = true;
            resolve();
          });
          this.kafkaConnection.on('error', (e) => {
            this._open = false;
            console.log(`A kafka error occured: ${e.message}\n${e.stack}`);
            process.exit(1);
          });
        } else {
          this._open = true;
          debug('kafka was not provided, not streaming logs');
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
    debug('sending logs to kafka');
    return new Promise((resolve, reject) => {
      if (this.kafkaConnection) {
        const msgs = event.trim().split('\n').map((x) => {
          if (process.env.SHOW_BUILD_LOGS) {
            console.log(x);
          }
          return {
            topic: (process.env.KAFKA_TOPIC || 'alamobuildlogs'),
            messages: [JSON.stringify({
              metadata: `${this.app}-${this.space}`,
              build: this.build_number,
              job: this.build_number.toString(),
              message: x,
            })],
          };
        });
        this.kafkaConnection.send(msgs, (err) => {
          if (err) {
            console.log(`Unable to send traffic to kafka: ${err.message}\n${err.stack}`);
            reject(err);
          }
          resolve();
        });
      } else {
        if (process.env.SHOW_BUILD_LOGS) {
          event.trim().split('\n').map((x) => console.log(x.trim()));
        }
        resolve();
      }
    });
  }

  async flushLogsToS3() {
    try {
      debug('flushing logs to s3');
      if (this.logInterval) {
        clearInterval(this.logInterval);
      }
      this.logInterval = null;
      if (this.logStream) {
        await common.putObject(
          `${this.app}-${this.app_uuid}-${this.build_number}.logs`,
          this.logStream.split('\r\n').join('\n'),
        );
      }
    } catch (e) {
      console.log(`Error, unable to flush logs: ${e.message}\n${e.stack}`);
    }
  }

  async sendLogsToS3(event) {
    if (!this.logInterval) {
      this.logInterval = setTimeout(this.flushLogsToS3.bind(this), 2000);
    }
    this.logStream += event;
  }

  async end() {
    debug(`closing and flushing logs for ${this.build_uuid}`);
    await this.flushLogsToS3();
    await this.sendLogsToKafka('Build finished');
  }

  async send(event) {
    try {
      debug('sending logs');
      await this.sendLogsToKafka(event);
      await this.sendLogsToS3(event);
    } catch (e) {
      console.log(`Error sending logs ${e.message}\n${e.stack}`);
    }
  }
}

module.exports = Logs;
