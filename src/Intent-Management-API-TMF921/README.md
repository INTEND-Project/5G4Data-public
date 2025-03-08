# TM Forum TMF921 Intent Management API
This folder holds an axample implementation of the TMF921 API for intent management. Only the parts needed for the 5G4DATA use-case is actually implemented. The API is created using [OpenAPI generator](https://openapi-generator.tech/). The OenAPI geenerator takes an API description in yaml format as input and is capable of creating the stubs for a server implementing the API in many programing languages and packages. As an example, it is possible to create the API in python+flask and the following description shows how to create the API as a python and [flask WSGI server](https://flask.palletsprojects.com/en/stable/). Many other options exists, see the server part [here](https://openapi-generator.tech/docs/generators) for more details.

## The API definition
The API definition that OpenAPI uses is expressed in yaml. The 5G4DATA API description can be found in the file [5g4dataAPI.yaml](5g4dataAPI.yaml). It contains all the details about the API. OpenAPI can automatically generate the server stubs from this file.

## Generate the server stubs
The easiest way to create the stubs is by using the docker version of the OpenAPI generator. Open a terminal window in the folder where the yaml file is stored and type

 ```
 docker run --rm -v "${PWD}:/local" openapitools/openapi-generator-cli generate  -i /local/5g4dataAPI.yaml -g python-flask -o /local/out/5g4data/python-flask
 ```
 This will run the generator in a docker container using the 5g4dataAPI.yaml API definition as input and will create the API server stubs in the ```./out/5g4data/python-flask``` folder.

 ## Build and run the generated API server (stubs)
 You now have the code for the server (stub), change current direcotry to the folder where the Docker file is ```cd out/5g4data/python-flask```. In this folder, first build the server using this command ```docker build -t openapi_server .```. This will create a docker images for your API server. Run the API server using this command ```docker run -p 8080:8080 openapi_server```. The server is now ready to accept https calls on ```https://localhost:8080```. The server also creates a swagger ui for the server and this ui can be accessed on ```http://localhost:8080/intentManagement/ui/```.

 ## Use the example client code (intent owner) to send an intent to the server (intent handler)

 
