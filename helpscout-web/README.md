# Help Scout Exporter Web UI

A web-based interface for exporting and analyzing Help Scout conversations.

## Setup

### Backend

1. Navigate to the backend directory:
   ```
   cd backend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create a `.env` file with your port configuration:
   ```
   PORT=3001
   ```

4. Start the development server:
   ```
   npm run dev
   ```

### Frontend

1. Navigate to the frontend directory:
   ```
   cd frontend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the development server:
   ```
   npm run dev
   ```

4. Open your browser and navigate to the URL shown in the terminal (usually http://localhost:5173)

## Usage

1. Enter your Help Scout API credentials (App ID and App Secret)
2. Select the date range and any filters you want to apply
3. Click "Export Conversations"
4. Download the CSV file with your conversation data

## Building for Production

### Backend 

## Building for macOS Distribution

To build the app for macOS distribution:

1. Run the macOS build script:
   ```
   node build-mac.js
   ```

2. When prompted, choose whether to notarize the app with Apple:
   - Notarization requires an Apple Developer account
   - You'll need your Apple ID and an app-specific password
   - Notarization can take several minutes to complete

3. The built app will be available in `electron/dist/`

### For macOS Users

When users download and try to open the app, they might see security warnings:

#### If the app is notarized:
1. Right-click (or Control-click) on the app
2. Select "Open" from the context menu
3. Click "Open" in the dialog that appears
4. The app should now open and future launches won't show warnings

#### If the app is not notarized:
1. Right-click (or Control-click) on the app
2. Select "Open" from the context menu
3. Click "Open" in the dialog that appears
4. If this doesn't work, open System Preferences > Security & Privacy
5. Look for a message about the blocked app and click "Open Anyway"

#### Alternative method using Terminal:
```bash
xattr -d com.apple.quarantine /path/to/Help\ Scout\ Exporter.app
```
