/* eslint-disable func-names, no-await-in-loop */
const request = require('request-promise-native');
const { expect } = require('chai');

describe('stopping builds', function () {
  const test = require('./support/init.js');
  this.timeout(100000);
  let pending = false;
  let successful = false;
  it('test stopping an active build', async () => {
    test.events.removeAllListeners('callback');
    const listener = (body) => {
      expect(body.id).equal(1);
      expect(body.type).equal('buildshuttle');
      if (body.status === 'pending') {
        pending = true;
      } else if (body.status === 'failed') {
        successful = true;
      } else {
        expect(false).to.equal(true);
      }
    };
    test.events.on('callback', listener);
    while (test.params.url === null) {
      await new Promise((res) => setTimeout(res, 1000));
    }
    await request(
      {
        method: 'post',
        headers: {
          'content-type': 'application/json',
        },
        uri: 'http://localhost:9000',
        body: JSON.stringify({
          sources: 'https://github.com/akkeris/build-app-test-repo/archive/master.zip',
          app: 'test',
          space: 'test',
          app_uuid: '56bce159-87a7-437f-bed3-2da4e44d9cf3',
          gm_registry_host: process.env.DOCKER_HOST || 'docker.io',
          gm_registry_repo: process.env.DOCKER_ORG || 'akkeris',
          gm_registry_auth: {
            username: process.env.DOCKER_LOGIN,
            password: process.env.DOCKER_PASS,
          },
          build_number: 1,
          build_uuid: '56bce159-87a7-437f-bed3-2da4e44d9cf3',
          callback: test.params.url,
          callback_auth: 'foobar',
        }),
      },
    );
    await test.wait(2000);
    const result = await request({ method: 'delete', uri: 'http://localhost:9000/test-56bce159-87a7-437f-bed3-2da4e44d9cf3/1' });
    expect(result).to.equal('{"status":"ok"}');
    while (pending === false) {
      await test.wait();
    }
    while (successful === false) {
      await test.wait();
    }
    test.events.removeListener('callback', listener);
    test.events.removeAllListeners('callback');
  });
});
