# Akkeris Build Shuttle

The build shuttle is a private API used by the controller-api to build docker images from sources.

[![Codacy Badge](https://api.codacy.com/project/badge/Grade/d6d102f668cf40f2856c85bbe3b9d45b)](https://www.codacy.com/app/Akkeris/buildshuttle?utm_source=github.com&amp;utm_medium=referral&amp;utm_content=akkeris/buildshuttle&amp;utm_campaign=Badge_Grade)
[![CircleCI](https://circleci.com/gh/akkeris/buildshuttle.svg?style=svg)](https://circleci.com/gh/akkeris/buildshuttle)
[![Codacy Badge](https://api.codacy.com/project/badge/Coverage/d6d102f668cf40f2856c85bbe3b9d45b)](https://www.codacy.com/app/Akkeris/buildshuttle?utm_source=github.com&utm_medium=referral&utm_content=akkeris/buildshuttle&utm_campaign=Badge_Coverage)

## Configuration

*  `PORT` - The port number to use to listen to new builds.
*  `NO_CACHE` - Whether to cache layers as much as possible during builds. If set to `true` docker build will not cache the pull or build.
*  `DOCKER_BUILD_IMAGE` - The docker image to use when spinning up worker nodes, the image defaults to `akkeris/buildshuttle:latest`
*  `DOCKER_BUILD_SETTINGS` -  A JSON structure passed into the `Docker` constructor telling the builder where to connect to for dockerd.  Defaults to `{socketPath: '/var/run/docker.sock'}`
*  `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_LOCATION` - Amazon S3 service to use to store build sources. Note that during tests it uses a temporary folder on the file system to simulate storing and reading from S3 and therefore the S3 services are not required for tests.
*  `EXTRA_BUILD_ARGS` - A json object where each key:value pair defines a new environment variable (ARG in docker) that is injected into the build. Note: sensitive information should not be injected should anyone have access to the resulting docker image.
*  `MAXIMUM_PARALLEL_BUILDS` - The maximum amount of parallel builds, this defaults to 4.
*  `DEBUG` - If set to any value it will print out information on requests received, stream build logs and other debugging information.

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

## Deploying

Deploying the buildshuttle in kubernetes requires creating a configmap and then deploying the manifest in `manifests/kubernetes.yaml`. This assumes your namespace for deployment is `akkeris-system`.

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

Save the above yaml file with real values into `configmap.yaml`.  Then run `kubectl create -f ./configmap.yaml -n akkeris-system --context [cluster]`.  Now deploy the manifest by running `kubectl create -f ./manifests/kubernetes.yaml -n akkeris-system --context [cluster]`.  Remember to replace `[cluster]` with your cluster name.

## Administrating

When a new build occurs the build shuttle will create a docker "sibling" container. This container is visible to docker but not necessarily visible to kubernetes scheduler (it's a bit complex, but sometimes it is, but it's not gauranteed).  To account for this, please take the following pre-cautions, this can be done before or after deployment.

### Dedicating nodes to builds

Create a node(s) with `akkeris.io/node-role=build` annotation. The buildshuttle (during scheduling) will prefer to be on these nodes, but will not refuse to deploy onto others.

### Containing the build workers

Each worker node has a limit of `500m` cpu (1/2 cpu, or cpu period of 100000, or cpu quota of 50000) and `1Gb` of memory. However, kubernetes is unaware of the underlying request and limits, therefore its scheduler can potentially overcommit the node the build shuttle is on accidently. One way of overcoming this is by making the request and limits of the build shuttle manfiest in (`manifests/kubernetes.yaml`) to include the limits and request of all the potential build workers it might create. 

If for example you plan on having a maximum of 4 parallel jobs, the requests for the buildshuttle should be `125m * 4 = 500m` and `500Mi * 4 = 2Gi` and the limits `500m * 4 = 2000m` and `1Gi * 4 = 4Gi`. You can adjust the maximum parallel jobs in the environment setting `MAXIMUM_PARALLEL_BUILDS`. This is (by default) set to 4.

### Fail safe precautions

You may also want to consider tainting the node containing the build shuttle.  This is a fail-safe precaution that can be taken which will prevent the kube scheduler from accidently overcommiting the node that the buildshuttle is on.

## References

https://jpetazzo.github.io/2015/09/03/do-not-use-docker-in-docker-for-ci/

https://applatix.com/case-docker-docker-kubernetes-part/

https://applatix.com/case-docker-docker-kubernetes-part-2/