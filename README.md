# Golf Scoring iOS App

Lightweight Expo + TypeScript starter for building the app on Windows and later installing it to an iPhone from a MacBook.

## What this project is set up for

- Fast editing in VS Code on this PC
- Early testing with Expo on Windows
- Later iPhone install/signing from a MacBook with Xcode

## Recommended workflow

### On this PC

1. Install Node.js LTS if it is not already installed.
2. Run `npm install`
3. Run `npx expo start`
4. Test with:
   - Expo Go on your iPhone
   - Android emulator on Windows
   - Web preview for rough UI checks

### On the MacBook

1. Pull or copy this project over
2. Run `npm install`
3. Install Xcode
4. Connect the iPhone to the MacBook
5. Run Expo or open the iOS project later when we add native build steps

## Why Expo SDK 54

Expo's current docs note that during the SDK 55 transition, SDK 54 is the safer choice if you plan to use Expo Go on a physical device.

## Next step

Describe the screens and scoring flow you want, and we can build the first version directly in this starter.
