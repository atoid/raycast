# Raycast

Javascript raycast game engine and level editor

This is a small 'just for fun' project to explore good old raycast technique in Javascript. This implementation is pure Javascript
and rendering is done directly to 2D canvas element. Various (but not all) optimizations are implemented: occusion culling,
sorting visible blocks, tracking rays only to shortest possible depth ... Check the code if you are interested in details.

Game can be played at:

https://atoid.github.io/raycast/raycast.html

Level editor can be used at:

https://atoid.github.io/raycast/leveleditor.html

To enable playing of the edited level, set localStorage variable in browser console:

localStorage.setItem("map_editor", 1)

In level editor define some blocks, set starting point and then save the level. Go to game link, refresh browser and
the saved level should appear. Have fun exploring what can be done with the block attributes!

To play default level again:

localStorage.removeItem("map_editor")

# Resources

Most of the samples are from BBC sound effects archive:

http://bbcsfx.acropolis.org.uk/

Textures and other gfx and rest of the samples were found around the Internet.
