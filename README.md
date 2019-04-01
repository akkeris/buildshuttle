# Akkeris Build Shuttle

The build shuttle is a private API used by the controller-api to build docker images from sources.

[![Codacy Badge](https://api.codacy.com/project/badge/Grade/d6d102f668cf40f2856c85bbe3b9d45b)](https://www.codacy.com/app/Akkeris/buildshuttle?utm_source=github.com&amp;utm_medium=referral&amp;utm_content=akkeris/buildshuttle&amp;utm_campaign=Badge_Grade)
[![CircleCI](https://circleci.com/gh/akkeris/buildshuttle.svg?style=svg)](https://circleci.com/gh/akkeris/buildshuttle)
[![Codacy Badge](https://api.codacy.com/project/badge/Coverage/d6d102f668cf40f2856c85bbe3b9d45b)](https://www.codacy.com/app/Akkeris/buildshuttle?utm_source=github.com&utm_medium=referral&utm_content=akkeris/buildshuttle&utm_campaign=Badge_Coverage)

## Configuration

*  `PORT` - The port number to use to listen to new builds.
*  `NO_CACHE` - Whether to cache layers as much as possible during builds. If set to `true` docker build will not cache the pull or build.
*  `DOCKER_BUILD_IMAGE` - The docker image to use when spinning up worker nodes, the image defaults to `akkeris/buildshuttle:latest`
*  `DOCKER_BUILD_SETTINGS` -  A JSON structure passed into the `Docker` constructor telling the builder where to connect to for dockerd.  Defaults to `{socketPath: '/var/run/docker.sock'}`. See [dockerode](https://github.com/apocas/dockerode#getting-started) for general settings that can be used here. In addition, see Getting Started section for more information.
*  `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_LOCATION` - Amazon S3 service to use to store build sources. Note that during tests it uses a temporary folder on the file system to simulate storing and reading from S3 and therefore the S3 services are not required for tests.
*  `EXTRA_BUILD_ARGS` - A json object where each key:value pair defines a new environment variable (ARG in docker) that is injected into the build. Note: sensitive information should not be injected should anyone have access to the resulting docker image.
*  `MAXIMUM_PARALLEL_BUILDS` - The maximum amount of parallel builds, this defaults to 4.
*  `DEBUG` - This uses the node [debug](https://www.npmjs.com/package/debug) module. Set to `DEBUG=*` to get all debug information, or `DEBUG=buildshuttle,buildshuttle-worker` to just receive debug information on the build shuttle.
* `TIMEOUT_IN_MS` - The timeout for builds, this is in milliseconds, the default is 20 minutes (or 1000 * 60 * 20).
* `KAFKA_TOPIC` - The topic to stream build logs to. 
* `SHOW_BUILD_LOGS` - Whether to show the build logs as part of the worker process.

## Starting

```bash
$ npm start
```

## Testing

You'll need to set the additional environment variables (minus amazon s3 stuff, it'll skip that) for running tests:

*  `DOCKER_LOGIN` - Docker repo password to push test images
*  `DOCKER_PASS` - Docker repo login to push test images
*  `DOCKER_HOST` - The docker host to push images, defaults to docker.io
*  `DOCKER_ORG` - The docker org to push images, defaults to akkeris
*  `NGROK_TOKEN` - In order to hear webhooks, a NGROK token is necessary, see www.ngrok.com for more information.
*  `CODACY_PROJECT_TOKEN` - To report code coverage set this token, otherwise reports are produced locally.
*  `SMOKE_TESTS` - Whether to run the smoke tests, set this to `true` to run extra tests.

```bash
$ npm test
```

## API

### Create a build

`POST /`

With payload:

```javascript
{
  sha, 
  app,
  space, 
  branch, 
  repo, 
  org, 
  callback,
  callback_auth,
  kafka_hosts,
  build_uuid, 
  app_uuid, 
  sources,
  gm_registry_host,
  gm_registry_auth,
  build_number,
  build_args, 
  docker_registry, 
  docker_login, 
  docker_password
}
```

This will trigger a build in a worker container. The `sources` field must be a uri for the sources (http, https, docker://host.com/org/repo:tag, or data uri).

### Get the build sources

`GET /{build_uuid}`

This will return the payload sources, this is only fetched by accompanying systems to resubmit builds or to examine sources.

### Deletes the build

`DELETE /{app_name}-{app_uuid}/{build_foreign_key}`

### Stops a build

`DELETE /{app_name}-{app_uuid}`

### Deletes the job

`GET /{app_name}-{app_uuid}/{build_foriegn_key}/logs`

Gets the logs for the build.

## Getting Started

This getting started guide assumes you're using the namespace `akkeris-system` and the deployment name `buildshuttle`. To start you'll need an S3 bucket from AWS. This is used to store logs and build images. Create a file called `buildshuttle-configmap.yaml` and put the following in:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: buildshuttle
  namespace: akkeris-system
data:
  S3_ACCESS_KEY: ...
  S3_BUCKET: ...
  S3_LOCATION: ...
  S3_REGION: ...
  S3_SECRET_KEY: ...
```

Make sure to replace the `...` with the appropriate values. Run `kubectl create -f ./configmap.yaml -n akkeris-system`.

Next you'll need to pick one of three ways to run buildshuttle: 

1. Run the buildhsuttle using the host
2. Run the buildshuttle with a worker
3. Run the buildshuttle with an external worker

There a few up and downsides, read over each and determine which is right for you.

### Running buildshuttle using the host

This is the default option that the buildshuttle will start up as if no other settings are provided. This uses the docker socket of the host that the buildshuttle is running on to perform builds.  

**Pros**

1. Does not require any additional setup or configuration, it-just-works.
2. Generally fast networking to send sources as its usually local. 
3. Less moving parts.
4. Build cache persists for the life of the node, improving performance of pulls.

**Cons**

1. If you're using kubernetes the CPU/memory cost is hidden from kubernetes. 
2. The node's host docker daemon may not be setup in an optimal way to build images, and may be slow.
3. It could interfer with any other processes running on the node as it can be CPU/memory intensive.
4. Since the builds run on the host this could pose a security risk.

While the default, this is not the best practice to run the builds on the host of the build shuttle. Mainly due to kubernetes not being fully aware and potentially overcommitting the node and causing other processes to be interrupted during builds.

This however might be ideal if you're running a small test cluster or have very infrequent builds which are small and isolated and cannot afford or do not want to run seperate processes for building. This also would require that your builds are done by trusted parties, where the commands being ran would not be malicious.

To deploy this type of configuration run `kubectl create -f ./manifests/buildshuttle-using-host.yaml -n akkeris-system`.

Note, it may be prudent to taint the node the build shuttle is running on so that no other processes run on it.  This is a fail safe precaution so that if the build shuttle and docker daemon takes up an inordinate amount of memory and CPU it does not conflict with other kubernetes processes running on the node.

### Running buildshuttle with a worker

This option is a great one if you have a modest build scenario that may only have two parallel builds (at most) at any time, and most builds complete within 5-10 minutes (and do not require more than 4GB of ram). 

**Pros**

1. The entire system runs inside of kubernetes.
2. Kubernetes is aware of the resources necessary for the buildshuttle.
3. More isolated and secure builds as they run d-in-d. 

**Cons**

1. Build cache does not persist and is reset on each deployment.
2. Not as performant as an external worker.
3. Cannot take advantage of file system overlay diffs like a native dockerd can.

This type of configuration is an ideal situation for systems with no more than 2-4 parallel builds, and build which do not run over 15 minutes (generally).

To deploy this type of configuration run `kubectl create -f ./manifests/buildshuttle-with-worker.yaml -n akkeris-system`.

### Running buildshuttle with an external worker

This option is ideal for production level build systems which need to have scalable fast networking. An external system is provisioned with whatever CPU and memory necessary to perform builds.  For a production level system a 4 CPU, 4GB system is recommended, with a 3.0Ghz processor or above (docker builds rely heavily on gzip and file system diffs and can be heavily reliant on CPU).

**Pros**

1. Can more easily scale load as necessary.
2. Will not interfer with existing kubernetes processes.
3. More performant due to native use of dockerd overlays and diffs.
4. Cache persists as long as system does. 

**Cons**

1. Potentially less secure than running worker inside kubernetes as its emphemeral and persists builds. 
2. More difficult to setup and administrate.

You'll need to modify the `DOCKER_BUILD_SETTINGS` in the file `./manifests/buildshuttle-with-external-worker.yaml` to set the ip and port (and potentially any other settings) to reach the dockerd (docker daemon) on an external server. If your docker daemon has specific connection requirements (such as mutual TLS authentication or connects over https) see [dockerode](https://github.com/apocas/dockerode#getting-started) for other options you can specify when connecting to the daemon.  See [configuring a docker daemon](https://docs.docker.com/config/daemon/) for more information on creating an external docker daemon worker for buildshuttle. For a simple example read the section **Creating an external worker** below.

To deploy this type of configuration (after you've modified the manifest!) run `kubectl create -f ./manifests/buildshuttle-with-external-worker.yaml -n akkeris-system`.

## References

https://jpetazzo.github.io/2015/09/03/do-not-use-docker-in-docker-for-ci/

https://applatix.com/case-docker-docker-kubernetes-part/

https://applatix.com/case-docker-docker-kubernetes-part-2/

### Creating an external worker

1. Create a `m4.xlarge` EC2 instance with the Amazon Linux 2 AMI (we tested on 2018.03)
2. SSH in and run `sudo yum install docker`
3. Modify `/etc/sysconfig/docker` and change the `OPTIONS` variable to `OPTIONS="--host tcp://0.0.0.0:2375 --host unix:///var/run/docker.sock --max-concurrent-downloads 20 --max-concurrent-uploads 20 --default-ulimit nofile=1024:4096"`.  This will expose the docker builder without authentication! Do not expose this publically! If you don't know what this means, stop right now as you'll be exposing a major security hole. Ensure the security group exposes port 2375 to the IP's of the buildshuttle.
4. Run `service docker start`