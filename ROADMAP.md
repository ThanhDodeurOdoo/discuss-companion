# Future Improvements

### App window closing behavior

menu / tray behavior.
currently, closing the app from the dock closes the app, it should be like
the red button which just closes the main window but leave the process on with the
top menu icon.

closing the app from the red button should also remove the app from the dock
(but not the process, which is already implemented).

### Cleaner extension architecture

There should be some kind of action/request interface that exposes
all the features of the app (ptt and other interactions with the main dwindow), then the extension can execute these actions from messages from the websocket or from extension shortcuts, or from popup buttons.

### Support for Linux
[@Issue#1](https://github.com/ThanhDodeurOdoo/discuss-companion/issues/1)


### Extension initialization handshake
(not to confuse with Firefox's extension own handshake)

The extension should send an initialization message through the ws to the app
with its version number (so we can check and maybe guard features).

the extension could also collect information on tabs (like which ones are odoo tabs, and send that origin to the app), although from the extension
point of view it's not clear which tab is relevant since it blindly sends
ptt commands to everything.

### Add github build script to auto generate file?

Would be nice to have a github action that automatically generates the app
and extension files when a new version is released.

(probably after stable version)

### Handle multiple websocket connections
(or to choose which connection to use)

For example if the user has multiple chrome profiles or firefox and chrome
at the same time, we need to be able to choose which connection to use.

Maybe a sidebar where we can select which ones receive the key events
and track some metadata about them (browser, version, origin, ...)

### Ability to control mute/deaf/... state

could be done with extension execution (see [extension utils](extension/src/utils.ts)) at `executeInCurrentTab()`.

# Nice-to-have

### Show partial key press

purely cosmetic,
For example when shortcut is CMD+SHIFT+K, when the user presses CMD,
it would highlight CMD, then when the user presses SHIFT, it would highlight SHIFT,
and finally when the user presses K, it would highlight K ( and do the usual
press down animation)


# Probably too fancy

### Handle multiple key bindings

Support multiple key bindings (either a fixed amount or an extensible list)
