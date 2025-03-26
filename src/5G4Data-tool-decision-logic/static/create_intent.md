# Create intents
> **⚠️ NOTE:**  
>It seems to be obvious that the detailed resource level intents (as in the examples below) will be created by *inSwitch* (i.e. *inSwitch* will be the owner of these intents). What *inChat* should create is a bit more unclear to us (TEL). We do believe that *inChat* could send TM Forum formated business level intents to *inSwitch*, but exactly how such an intend should be formed is still TBD. In its simplest form it could contain one single Expectation with a textual **dct:description** (in json format?) containing the parameters needed to fill into the templates below.

# Templates for creating TM Forum formatted intents for the data5g use-case
In the INTEND project's data5g use-case, all intents (exept the initial natural languague version based on a dialogue with the user/customer) shall be formatted using the TM Forum Intent ontology v.3.6.0 or later versions.

Since the data5g use-case is very limited in scope compared to the larger field of autonomous networks it will be possible to create generic templates for how the network and compute intents can be formed. This will make the work of translating natural languague intents into properly formatted TM Forum intents easier. Note that the proposed templates clearly limits the types of intents that it is posisble to create, but keep in mind that the limitation matches the capabilities of the data5g use-case infrastructure and intents that is outside the scope of the templates would in any case not be posible to fulfill.
> **⚠️ NOTE:**  
> Regard this as a first suggestion. The TM Forum ontology can
> be expanded as we see fit. Bottom line is that we can create
> these intents as we would like as long as the intent owner and
> intent handler has a consolidated understanding of what the
> intent exchanged between the owner and handler is all about
> (agree on the semantics expressed in the intent)


## Template for network configuration
The only network related configurations that it will be possible to do in the data5g use-case is the creation of network slices with different QoS guaranties related to network latency, network bandwidth and possibly packet error rate (TBD). In addition to the QoS metrics, it is also possible to define in which geographical area the slice (and thus the QoS guaranties) shall be valid for. Tools participating in the management of an intent will have to fill in these metrics and geo-location details in the template.

Slice QoS intent example (as given to inNet as handler):
```turtle
@prefix data5g: <http://data5g.eu/data5g#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix geo: <http://www.opengis.net/ont/geosparql#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:I1 a icm:Intent ;
    log:allOf ( data5g:DE1 data5g:RE1 ) ;
.

data5g:DE1 a icm:DeliveryExpectation ;
    icm:target data5g:network-slice ;
    dct:description "Ensure low latency and sufficient bandwidth in the 5G network for customer +47 90914547 store in Tromsø."@en ;
    log:allOf ( data5g:C1 data5g:C2 data5g:CX1 ) ;
.

data5g:C1 a icm:Condition ;
    set:forAll (
    _:X
    [ icm:valuesOfTargetProperty ( data5g:5GTelenorLatency ) ]
    quan:smaller ( _:X [ rdf:value "20"^^xsd:decimal ; quan:unit "ms" ] )
    ) ;
.

data5g:C2 a icm:Condition ;
    set:forAll (
    _:X
    [ icm:valuesOfTargetProperty ( data5g:5GTelenorBandwidth ) ]
    quan:larger ( _:X [ rdf:value "300"^^xsd:decimal ; quan:unit "mbit/s" ] )
    ) ;
.

data5g:CX1 a icm:Context ;
    data5g:appliesToRegion data5g:K1ShoppingMallRegion ;
    data5g:appliesToCustomer "+47 90914547"^^xsd:string
.

data5g:K1ShoppingMallRegion a geo:Feature ;
    geo:hasGeometry [
    a geo:Polygon ;
    geo:asWKT "POLYGON((69.673545 18.921344, 69.673448 18.924026, 69.672195 18.923903, 69.672356 18.921052))"^^geo:wktLiteral ;
    ] ;
.

data5g:RE1 a icm:ReportingExpectation ;
    icm:target data5g:5GNetwork ;
    dct:description "Report if expectation is met with reports including metrics related to expectations."@en ;
.
```

## Variations
In addition to varying numbers for latency, bandwidth, geographical region (and potentially packet_error_rate), the slice QoS example can have a certain degree of variation along other paths as well. Some examples are mentioned in the following subsections.

### Variation in quan function for metrics
The metrics may be used toghether with other quan operator functions. Examples are:

- atLeast
- atMost
- inRange
- mean
- median

See the TM Forum quan ontology for more details.

### Variation related to Expectations
In addition to the logistic function (log:) *allOf* other logistic functions may be used. Some examples are:

 - oneOff
 - anyOff

See the TM Forum log ontology for more details.

It is also possible that other types of expectations could be formed in the future. Some examples include *green* expectations or *security/privacy* related expectations.
> **⚠️ NOTE:**  
> ReportingExpectation is not needed for the open loop MVS, it is added as a reference to illustrate that ReportingExpectation will be added in the future. Note also that how to form these ReportingExpectation is TBD for the data5g use-case.

### Slice related intents variation conclusion
Some variations are explicitly mentioned and for the MVS, not even all of them are needed to illustrate the concept in a first PoC. Note that other variations can be added as deemed necessary or benefitial by tool owners related to their offerings.

## Template for workload deployment
For the data5g use-case the workloads must be cloud-native, meaning that they are containerized and ready to be deployed to a Kubernetes cluster. We will create a workload-catalogue that describes workloads that it is possible to deploy to an data5g Edge data centre. How this catalogue is to be structured is still TBD, but the catalogue will in addition to the containers include descriptions on how to deploy them (probably a yaml file) and resource requirements for the container(s) (probably in json format) that is part of the workload.

These requirements sets (limits) the scope of what and how workloads can be deployed and thereby makes it possible to create deployment templates formatted as TM Forum intent descriptions. This will again make it easier to transform content in natural language expressed intents into properly formatted deployment intents for the data5g use-case. What remains to decide is then: when, which workload and to where the workload should be deployed. Note that a workload may have more than one container associated to it.


Compute intent example (as given to inNet as handler)
```turtle
@prefix data5g: <http://data5g.eu/data5g#> .
@prefix dct: <http://purl.org/dc/terms/> .
@prefix geo: <http://www.opengis.net/ont/geosparql#> .
@prefix icm: <http://tio.models.tmforum.org/tio/v3.6.0/IntentCommonModel/> .
@prefix log: <http://tio.models.tmforum.org/tio/v3.6.0/LogicalOperators/> .
@prefix quan: <http://tio.models.tmforum.org/tio/v3.6.0/QuantityOntology/> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix set: <http://tio.models.tmforum.org/tio/v3.6.0/SetOperators/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

data5g:I1 a icm:Intent ;
  log:allOf ( data5g:DE1 data5g:RE2 ) ;
.

data5g:DE1 a data5g:DeploymentExpectation ;
  icm:target data5g:deployment ;
  dct:description "Ensure the AR application is deployed to a local Edge Data Center with compute latency below 10ms."@en ;
  log:allOf ( data5g:C1 data5g:CX1 ) ;
.

data5g:C1 a icm:Condition ;
  set:forAll ( _:X
    [ icm:valuesOfTargetProperty ( data5g:ComputeLatency ) ]
    quan:smaller ( _:X [ rdf:value "20"^^xsd:decimal ;
      quan:unit "ms"
    ] )
  ) ;
.

data5g:CX1 a icm:Context ;
  data5g:DataCenter "EC1" ;
  data5g:Application "AR-retail-app" ;
  data5g:DeploymentDescriptor "http://intend.eu/data5gWorkloadCatalogue/ar-retail-app-deployment.yaml" ;
.

data5g:RE1 a icm:ReportingExpectation ;
  icm:target data5g:EdgeDataCenter ;
  dct:description "Report whether the Edge Data Center compute latency expectation is met with true or false reports."@en ;
.
```
## Variations
As for network intents, the log function used in expressing Conditions in Expectations and the quan function for metrics in Conditions may vary. In addition, the data5g:DataCenter , data5g:Application and the data5g:DeploymentDescriptor values will of course differ for different intents.
