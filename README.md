# Help Scout Conversation Exporter

A command-line tool to export and analyze Help Scout conversations.

## Installation

### Option 1: Standalone Executable (Recommended for non-technical users)

1. Download the executable for your platform:
   - Windows: `helpscout-exporter.exe`
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

