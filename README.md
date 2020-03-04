# About

Javascript runtime for Stucco functions in Azure Functions host

# Usage

Build new image with your function like this:

```
FROM gqleditor/stucco-js-azure-worker:node12

ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true

COPY . /home/site/wwwroot

RUN cd /home/site/wwwroot && \
    npm install --production

WORKDIR /home/site/wwwroot
```
