I started by using this prompt in ChatGPT (model version 5.2):
```
I have a tool called inServ that will:
 - receive an intent in turtle format from inChat
 - parse the intent to see if it is a combined intent, if yes, split it.
 - Forward workload part of the intent to a tool called inOrch
 - Forward the network part of the intent to a tool called inNet
 
Create an animation that illustrates it for this intent:

I added the turtle for a combined intent (but deleted it here for brevity).....
```
ChatGPT generated a python script to create the animation. I copied the python code to cursor and asked cursor agent to modify it as I wanted. Here are some examples of prompt that I gave the Cursor Agent:
```
@create_inServ_animation.py Move the inServ rectangle to be under the inChat rectangle and move "Split Result" rectangle up and make it bigger to allow more information in the subrectangle "Network Intent (to inNet)". The "Split Result" rectangle should fill the height of the window.
```
```
Some more adjustments:
1) Make the arrow from inServ rectangle start from the right hand side of the rectangle and and at the left hand side of the "Split Result" rectangle. 
2)Adjust the position of the inOrch rectangle and the inNet rectangle to allow the arrows to be horisontal from the "Split Result" rectangle. 
3) Make the arrow from inChat to inServ a little bit longer.
```
```
1) Make the arrow from inChat to inServ a bit longer (i.e. move the inServ rectangle a bit further down). 
2) After the "Parse + detect" animation, add a "Split" animation that moves over the arrow from inServ to "Split Result"
```

The final python script can be found [here](./create_inServ_animation.py).