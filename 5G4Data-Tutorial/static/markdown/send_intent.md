# TM Forum TMF921 Intent Management API
This github repo [folder](https://github.com/INTEND-Project/5G4Data-public/tree/main/Lifecycle-Management/src/Intent-Management-API-TMF921) holds an example implementation of the TMF921 API for intent management. The API is created using [OpenAPI generator](https://openapi-generator.tech/). The OpenAPI generator takes an API description in yaml format as input and is capable of creating the stubs for a server implementing the API in many programing languages and packages. As an example, it is possible to create the API in python+flask and the following description shows how to create the API as a python and [flask WSGI server](https://flask.palletsprojects.com/en/stable/). Many other options exists, see the server part [here](https://openapi-generator.tech/docs/generators) for more details.

So far, only the routes marked with a green dot (🟢) in the **OK** cell in the table below has been implemented:
|<div style="width:25px">OK</div>|<div style="width:40px">route</div>|HTTP method|<div style="width:300px">Description</div>|
|------|---------------|-------|--------------|
| 🟢 | /intent          | GET    | List or find Intent objects |
| 🟢 | /intent          | POST   | Create an Intent |
| 🟢 | /intent/{id}     | GET    | Retrieve an Intent by ID |
| 🟢 | /intent/{id}     | PATCH  | Partially update an Intent entity |
| 🟢 | /intent/{id}     | DELETE | Delete an Intent entity |
| 🔴 | /intent/{intentId}/intentReport | GET    | List or find IntentReport objects |
| 🔴 | /intent/{intentId}/intentReport/{id} | GET    | Retrieve an IntentReport by ID |
| 🔴 | /intent/{intentId}/intentReport/{id} | DELETE | Delete an IntentReport entity |
| 🔴 | /intentSpecification | GET    | List or find IntentSpecification objects |
| 🔴 | /intentSpecification | POST   | Create an IntentSpecification |
| 🔴 | /intentSpecification/{id} | GET    | Retrieve an IntentSpecification by ID |
| 🔴 | /intentSpecification/{id} | PATCH  | Partially update an IntentSpecification entity |
| 🔴 | /intentSpecification/{id} | DELETE | Delete an IntentSpecification entity |
| 🔴 | /hub              | POST   | Create a subscription (hub) to receive Events |
| 🔴 | /hub/{id}        | DELETE | Remove a subscription (hub) to receive Events |
| 🔴 | /listener/* | POST | Client listener for misc (*) event types, see the TMF921 for more details |

Note that for the open loop control MVS, the POST/intent is the only route that is required, but it would probably be benefitial to add some more routes (e.g. ```GET/intent, GET/intent/{id}, DELETE/intent/{id}```, etc.).

Note also that it could be interesting to experiment with the hub/listener routes to gain experience with the pub/sub mechanisms for reporting that is part of the TMF921 API.

Note that for the open loop control MVS, the POST/intent is the only route that is required, but it would probably be benefitial to add some more routes (e.g. ```GET/intent, GET/intent/{id}, DELETE/intent/{id}```, etc.).

Note also that it could be interesting to experiment with the hub/listener routes to gain experience with the pub/sub mechanisms for reporting that is part of the TMF921 API.


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
We have also added a python [client](https://github.com/INTEND-Project/5G4Data-public/tree/main/Lifecycle-Management/src/CreateIntent) program. The client program "simulates" an intent owner, and the API server is in this setting the intent handler. Run the python client like this ```python create_intent_tm921.py```
 
