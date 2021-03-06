/* eslint-disable func-names, no-await-in-loop */
const request = require('request-promise-native');
const { expect } = require('chai');

describe('test failures for builds', function () {
  const test = require('./support/init.js');
  this.timeout(100000);
  let pending = false;
  let failure = false;

  it('test a build failing from a bad image', async () => {
    test.events.removeAllListeners('callback');
    const listener = (body) => {
      expect(body.id).equal(1);
      expect(body.type).equal('buildshuttle');
      if (body.status === 'pending') {
        pending = true;
      } else if (body.status === 'failed') {
        failure = true;
      } else {
        console.log('received unexpected build status:', body.status);
        expect(false).to.equal(true);
      }
    };
    test.events.on('callback', listener);
    while (test.params.url === null) {
      await test.wait();
    }
    const response = await request(
      {
        method: 'post',
        headers: {
          'content-type': 'application/json',
        },
        uri: 'http://localhost:9000',
        body: JSON.stringify({
          sources: 'docker://docker.io/akkeris/foobar-test-nonexistant:latest',
          app: 'test3',
          space: 'test3',
          app_uuid: '56bce159-87a7-437f-bed3-2da4e44d9aaa',
          gm_registry_host: process.env.DOCKER_HOST || 'docker.io',
          gm_registry_repo: process.env.DOCKER_ORG || 'akkeris',
          gm_registry_auth: {
            username: process.env.DOCKER_LOGIN,
            password: process.env.DOCKER_PASS,
          },
          build_number: 1,
          build_uuid: '56bce159-87a7-437f-bed3-2da4e44d9eee',
          callback: test.params.url,
          callback_auth: 'foobar',
        }),
      },
    );
    expect(response).to.equal('{"status":"ok"}');
    while (pending === false) {
      await test.wait();
    }
    while (failure === false) {
      await test.wait();
    }
    test.events.removeListener('callback', listener);
    test.events.removeAllListeners('callback');
  });

  it('test a build failing from a bad uri for sources', async () => {
    test.events.removeAllListeners('callback');
    pending = false;
    failure = false;
    const listener = (body) => {
      expect(body.id).equal(1);
      expect(body.type).equal('buildshuttle');
      if (body.status === 'pending') {
        pending = true;
      } else if (body.status === 'failed') {
        failure = true;
      } else {
        console.log('received unexpected build status:', body.status);
        expect(false).to.equal(true);
      }
    };
    test.events.on('callback', listener);
    const response = await request(
      {
        method: 'post',
        headers: {
          'content-type': 'application/json',
        },
        uri: 'http://localhost:9000',
        body: JSON.stringify({
          sources: 'https://www.doesnotexist-abcde-example.com/and/shouldnt/exist.',
          app: 'test3',
          space: 'test3',
          app_uuid: '56bce159-87a7-437f-bed3-2da4e44d9aaa',
          gm_registry_host: process.env.DOCKER_HOST || 'docker.io',
          gm_registry_repo: process.env.DOCKER_ORG || 'akkeris',
          gm_registry_auth: {
            username: process.env.DOCKER_LOGIN,
            password: process.env.DOCKER_PASS,
          },
          build_number: 1,
          build_uuid: '56bce159-87a7-437f-bed3-2da4e44d9eee',
          callback: test.params.url,
          callback_auth: 'foobar',
        }),
      },
    );
    expect(response).to.equal('{"status":"ok"}');
    while (pending === false) {
      await test.wait();
    }
    while (failure === false) {
      await test.wait();
    }
    test.events.removeListener('callback', listener);
    test.events.removeAllListeners('callback');
  });

  it('test failures a build from a bad data uri', async () => {
    test.events.removeAllListeners('callback');
    pending = false;
    failure = false;
    const listener = (body) => {
      expect(body.id).equal(1);
      expect(body.type).equal('buildshuttle');
      if (body.status === 'pending') {
        pending = true;
      } else if (body.status === 'failed') {
        failure = true;
      } else {
        console.log('received unexpected build status:', body.status);
        expect(false).to.equal(true);
      }
    };
    test.events.on('callback', listener);
    while (test.params.url === null) {
      await test.wait();
    }
    const response = await request(
      {
        method: 'post',
        headers: {
          'content-type': 'application/json',
        },
        uri: 'http://localhost:9000',
        body: JSON.stringify({
          sources: 'data:base64,aasdfasdfasdfdsa',
          app: 'test',
          space: 'test',
          app_uuid: '56bce159-87a7-437f-bed3-2da4e44d9ddd',
          gm_registry_host: process.env.DOCKER_HOST || 'docker.io',
          gm_registry_repo: process.env.DOCKER_ORG || 'akkeris',
          gm_registry_auth: {
            username: process.env.DOCKER_LOGIN,
            password: process.env.DOCKER_PASS,
          },
          build_number: 1,
          build_uuid: '56bce159-87a7-437f-bed3-2da4e44d9fff',
          callback: test.params.url,
          callback_auth: 'foobar',
        }),
      },
    );
    expect(response).to.equal('{"status":"ok"}');
    while (pending === false) {
      await test.wait();
    }
    while (failure === false) {
      await test.wait();
    }
    test.events.removeListener('callback', listener);
    test.events.removeAllListeners('callback');
  });

  it('test failures a build with failed build', async () => {
    test.events.removeAllListeners('callback');
    pending = false;
    failure = false;
    const listener = (body) => {
      expect(body.id).equal(3);
      expect(body.type).equal('buildshuttle');
      if (body.status === 'pending') {
        pending = true;
      } else if (body.status === 'failed') {
        failure = true;
      } else {
        console.log('received unexpected build status:', body.status);
        expect(false).to.equal(true);
      }
    };
    test.events.on('callback', listener);
    while (test.params.url === null) {
      await test.wait();
    }
    const response = await request(
      {
        method: 'post',
        headers: {
          'content-type': 'application/json',
        },
        uri: 'http://localhost:9000',
        body: JSON.stringify({
          sources: 'https://github.com/akkeris/build-app-test-repo/archive/failure.zip',
          app: 'test',
          space: 'test',
          app_uuid: '56bce159-87a7-437f-bed3-2da4e44d9d33',
          gm_registry_host: process.env.DOCKER_HOST || 'docker.io',
          gm_registry_repo: process.env.DOCKER_ORG || 'akkeris',
          gm_registry_auth: {
            username: process.env.DOCKER_LOGIN,
            password: process.env.DOCKER_PASS,
          },
          build_number: 3,
          build_uuid: '56bce159-87a7-437f-bed3-2da4e44d9ff1',
          callback: test.params.url,
          callback_auth: 'foobar',
        }),
      },
    );
    expect(response).to.equal('{"status":"ok"}');
    while (pending === false) {
      await test.wait();
    }
    while (failure === false) {
      await test.wait();
    }
    test.events.removeListener('callback', listener);
    test.events.removeAllListeners('callback');
  });


  it('test failures a build from docker with invalid pull auth', async () => {
    pending = false;
    failure = false;
    test.events.removeAllListeners('callback');
    const listener = (body) => {
      expect(body.id).equal(1);
      expect(body.type).equal('buildshuttle');
      if (body.status === 'pending') {
        pending = true;
      } else if (body.status === 'failed') {
        failure = true;
      } else {
        console.log('received unexpected build status:', body.status);
        expect(false).to.equal(true);
      }
    };
    test.events.on('callback', listener);
    while (test.params.url === null) {
      await test.wait();
    }
    const response = await request(
      {
        method: 'post',
        headers: {
          'content-type': 'application/json',
        },
        uri: 'http://localhost:9000',
        body: JSON.stringify({
          sources: 'docker://nope:nada@docker.io/akkeris/buildshuttle:latest',
          app: 'test4',
          space: 'test4',
          app_uuid: '56bce159-87a7-437f-bed3-2da4e44d9333',
          gm_registry_host: process.env.DOCKER_HOST || 'docker.io',
          gm_registry_repo: process.env.DOCKER_ORG || 'akkeris',
          gm_registry_auth: {
            username: process.env.DOCKER_LOGIN,
            password: process.env.DOCKER_PASS,
          },
          build_number: 1,
          build_uuid: '56bce159-87a7-437f-bed3-2da4e44d9333',
          callback: test.params.url,
          callback_auth: 'foobar',
        }),
      },
    );
    expect(response).to.equal('{"status":"ok"}');
    while (pending === false) {
      await test.wait();
    }
    while (failure === false) {
      await test.wait();
    }
    test.events.removeListener('callback', listener);
  });
});
