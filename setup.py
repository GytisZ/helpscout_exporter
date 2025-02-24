from setuptools import setup

APP = ['main.py']
DATA_FILES = ['README.md']
OPTIONS = {
    'argv_emulation': True,
    'packages': ['click', 'dotenv', 'requests', 'bs4'],
    'plist': {
        'CFBundleName': 'Help Scout Exporter',
        'CFBundleDisplayName': 'Help Scout Exporter',
        'CFBundleVersion': '1.0.0',
        'CFBundleShortVersionString': '1.0.0',
    }
}

setup(
    app=APP,
    data_files=DATA_FILES,
    options={'py2app': OPTIONS},
    setup_requires=['py2app'],
) 
