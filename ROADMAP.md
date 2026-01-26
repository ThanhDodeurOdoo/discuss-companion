# Future Improvements

### App window closing behavior

menu / tray behavior.
currently, closing the app from the dock closes the app, it should be like
the red button which just closes the main window but leave the process on with the
top menu icon.

closing the app from the red button should also remove the app from the dock
(but not the process, which is already implemented).

### Support for Linux [@Issue#1](https://github.com/ThanhDodeurOdoo/discuss-companion/issues/1)

Make a linux compilation target.

### Extension initialization handshake
(not to confuse with Firefox's extension own handshake)

The extension should send an initialization message through the ws to the app
with its version number (so we can check and maybe guard features).

### Support the toggle ptt API

see the switch/case `switch (message.bodyType())` in [background.ts](extension/src/background.ts),
this should implement the `"toggle-voice"` command.

The user experience may be a bit sketchy without feedback from Odoo though because we can
only guess if the command was successful or not, and cannot know if the state was altered in-app.

### Add github build script to auto generate file?

Would be nice to have a github action that automatically generates the app
and extension files when a new version is released.

(probably after stable version)

### Handle multiple websocket connections
(or to choose which connection to use)

For example if the user has multiple chrome profiles or firefox and chrome
at the same time, we need to be able to choose which connection to use.

Maybe a sidebar where we can select which ones receive the key events.

### Ability to control mute/deaf/... state

could be done with extension execution (see [extension utils](extension/src/utils.ts)) at `executeInMainWorld()`.

# Nice-to-have

### Show partial key press

purely cosmetic,
For example when shortcut is CMD+SHIFT+K, when the user presses CMD,
it would highlight CMD, then when the user presses SHIFT, it would highlight SHIFT,
and finally when the user presses K, it would highlight K ( and do the usual
press down animation)

### A pause button?

When paused, the app would not listen for any key press
(send keyup on pause to make sure not to pause in down pos)


# Probably too fancy

### Handle multiple key bindings

Support multiple key bindings (either a fixed amount or an extensible list)