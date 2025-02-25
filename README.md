# Help Scout Conversation Exporter

A command-line tool to export and analyze Help Scout conversations.

This repository contains both a command-line tool and a web-based interface for exporting Help Scout conversations.

## Installation

### Command-Line Tool

### Option 1: Standalone Executable (Recommended for non-technical users)

1. Download the executable for your platform:
   - Mac/Linux: `helpscout-exporter`

2. Run the setup wizard:
   ```
   # Windows
   helpscout-exporter.exe setup
   
   # Mac/Linux
   ./helpscout-exporter setup
   ```

### Option 2: From Source

1. Clone this repository:
   ```
   git clone https://github.com/yourusername/helpscout-exporter.git
   cd helpscout-exporter
   ```

2. Install requirements:
   ```
   pip install -r requirements.txt
   ```

3. Run the setup wizard:
   ```   python main.py setup
   ```

### Web Interface

For non-technical users, we also provide a web-based interface. See the [helpscout-web](./helpscout-web) directory for setup instructions.

### Desktop Application

For the easiest experience, download the desktop application:

1. Go to the [Releases](https://github.com/yourusername/helpscout-exporter/releases) page
2. Download the appropriate installer for your platform:
    - Windows: `Help-Scout-Exporter-Setup-x.x.x.exe`
    - macOS: `Help-Scout-Exporter-x.x.x.dmg`
    - Linux: `Help-Scout-Exporter-x.x.x.AppImage`
3. Run the installer and follow the prompts
4. Launch the application from your desktop or start menu

## Getting Help Scout API Credentials

To use this tool, you need to create an app in Help Scout:

1. Log in to your Help Scout account
2. Go to Your Profile > My Apps
3. Click "Create My App"
4. Give your app a name (e.g., "Help Scout Exporter") 
5. Copy the App ID and App Secret
6. Use these credentials in the setup wizard

## Usage

### Export and analyze conversations

```
python main.py export --from 2023-01-01 --tag "preorder & presale"
```

This will:
1. Fetch all matching conversations
2. Save them as JSON files in a timestamped directory
3. Create a summary CSV file with all messages

### Advanced: Fetch raw data only

If you only want the raw conversation data without analysis:

```
python main.py fetch --from 2023-01-01 --tag "preorder & presale" --output-dir my_data
```

### List available tags

```
python main.py list-tags
```

### macOS Security Warning

If you see a security warning on macOS:

1. **Method 1: Using Finder**
   - Right-click (or Control-click) on the executable
   - Select "Open" from the context menu
   - Click "Open" in the dialog that appears

2. **Method 2: Using Terminal**
   - After downloading, run:
     ```
     chmod +x helpscout-exporter
     xattr -d com.apple.quarantine helpscout-exporter
     ./helpscout-exporter setup
     ```

