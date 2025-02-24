import PyInstaller.__main__
import platform
import os

# Determine the output name based on platform
if platform.system() == "Windows":
    output_name = "helpscout-exporter.exe"
else:
    output_name = "helpscout-exporter"

# Create the dist directory if it doesn't exist
os.makedirs("dist", exist_ok=True)

# Run PyInstaller with different options for macOS
if platform.system() == "Darwin":  # macOS
    PyInstaller.__main__.run([
        'main.py',
        '--name=%s' % output_name,
        '--onefile',
        '--clean',
        '--add-data=README.md:.',
        '--hidden-import=click',
        '--hidden-import=dotenv',
        '--target-architecture=universal2',  # For both Intel and Apple Silicon
        '--windowed',  # Prevents terminal window from appearing
    ])
else:
    PyInstaller.__main__.run([
        'main.py',
        '--name=%s' % output_name,
        '--onefile',
        '--clean',
        '--add-data=README.md:.',
        '--hidden-import=click',
        '--hidden-import=dotenv',
    ])

print(f"\nBuild complete! Your executable is in the dist/ directory.")
print(f"You can distribute 'dist/{output_name}' to users.") 
