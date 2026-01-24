## Future Improvements

### App window closing behavior

menu / tray behavior.
currently, closing the app from the dock closes the app, it should be like
the red button which just closes the main window but leave the process on with the
top menu icon.

closing the app from the red button should also remove the app from the dock (but not the process, which is already implemented).

### Support for Linux

Make a linux compilation target.
[Issue#1](https://github.com/ThanhDodeurOdoo/discuss-companion/issues/1)

### Add github build script to auto generate file?

Would be nice to have a github action that automatically generates the app and extension files when a new version is released.

### Ability to control mute/deaf/... state

This requires an improved Odoo side API to control the state of the user in the call,
unless we can send arbitrary code to the browser but that's sketchy.

## Nice-to-have

### Show partial key press

purely cosmetic,
For example when shortcut is CMD+SHIFT+K, when the user presses CMD, it would highlight CMD, then when the user presses SHIFT, it would highlight SHIFT, and finally when the user presses K, it would highlight K ( and do the usual press down animation)

### A pause button?

When paused, the app would not listen for any key press
(send keyup on pause to make sure not to pause in down pos)