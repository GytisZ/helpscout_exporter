import os
import requests
from datetime import datetime, timezone, timedelta
import json
from typing import Generator, Dict, Any, Optional
import time
import click
import csv
from bs4 import BeautifulSoup
import sys
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

@click.group()
def cli():
    """Help Scout API client"""
    pass

class HelpScoutAPI:
    BASE_URL = 'https://api.helpscout.net/v2'
    AUTH_URL = 'https://api.helpscout.net/v2/oauth2/token'
    
    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.session = requests.Session()
        self.access_token = None
        self.token_file = '.helpscout_token.json'
        self._load_or_refresh_token()

    def _load_or_refresh_token(self):
        """
        Load existing token from file or get a new one if expired/missing.
        """
        try:
            with open(self.token_file, 'r') as f:
                token_data = json.load(f)
                # Check if token is still valid (expires in 2 days)
                expires_at = datetime.fromisoformat(token_data['expires_at'])
                if expires_at > datetime.now(timezone.utc):
                    self.access_token = token_data['access_token']
                    self.session.headers.update({
                        'Authorization': f'Bearer {self.access_token}',
                        'Content-Type': 'application/json'
                    })
                    return
        except (FileNotFoundError, KeyError, json.JSONDecodeError):
            pass
        
        # Token doesn't exist, is invalid, or has expired
        self._authenticate()

    def _authenticate(self):
        """
        Get access token using OAuth2 Client Credentials flow.
        """
        auth_response = requests.post(
            self.AUTH_URL,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
            data=[
                ('grant_type', 'client_credentials'),
                ('client_id', self.client_id),
                ('client_secret', self.client_secret)
            ]
        )
        
        if auth_response.status_code != 200:
            print(f"Error response: {auth_response.text}")
            
        auth_response.raise_for_status()
        
        auth_data = auth_response.json()
        self.access_token = auth_data['access_token']
        self.session.headers.update({
            'Authorization': f'Bearer {self.access_token}',
            'Content-Type': 'application/json'
        })

        # Save token with expiration time (2 days from now)
        token_data = {
            'access_token': self.access_token,
            'expires_at': (datetime.now(timezone.utc) + 
                         timedelta(days=2)).isoformat()
        }
        with open(self.token_file, 'w') as f:
            json.dump(token_data, f)

    def _handle_response(self, response: requests.Response) -> requests.Response:
        """
        Handle API response, including re-authentication if token expires.
        """
        if response.status_code == 401:
            # Token might have expired, try to re-authenticate
            self._load_or_refresh_token()
            # Update the request with new token and retry
            response.request.headers['Authorization'] = self.session.headers['Authorization']
            return self.session.send(response.request)
        return response

    def get_conversations(
        self,
        created_from: datetime,
        created_to: Optional[datetime] = None,
        tags: Optional[list[str]] = None,
        status: str = 'all'
    ) -> Generator[Dict[str, Any], None, None]:
        """
        Fetch all conversations, handling pagination.
        
        Args:
            created_from: Datetime to filter conversations created after this time
            created_to: Optional datetime to filter conversations created before this time
            tags: Optional list of tags to filter conversations
            status: Conversation status filter ('all', 'active', 'closed', 'open', 'pending', 'spam')
            
        Yields:
            Dict containing conversation data with embedded threads
        """
        # Format dates for query - always use UTC midnight
        created_from_utc = created_from.astimezone(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        created_from_str = created_from_utc.strftime('%Y-%m-%dT00:00:00Z')
        
        # Build the createdAt query
        if created_to:
            created_to_utc = created_to.astimezone(timezone.utc).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            created_to_str = created_to_utc.strftime('%Y-%m-%dT00:00:00Z')
            created_query = f'(createdAt:[{created_from_str} TO {created_to_str}])'
        else:
            created_query = f'(createdAt:[{created_from_str} TO *])'

        params = {
            'status': status,
            'embed': 'threads',
            'page': 1,
            'query': created_query
        }

        # Add tags if provided
        if tags:
            params['tag'] = ','.join(tags)

        total_conversations = 0
        processed_conversations = 0

        while True:
            # Build and print the full request URL
            url = f'{self.BASE_URL}/conversations'
            
            response = self.session.get(url, params=params)
            response = self._handle_response(response)
            
            if response.status_code == 429:  # Rate limit hit
                retry_after = int(response.headers.get('Retry-After', 60))
                time.sleep(retry_after)
                continue
                
            response.raise_for_status()
            data = response.json()
            
            # Get total on first page
            if params['page'] == 1:
                total_conversations = data['page']['totalElements']
                print(f'Found {total_conversations} matching conversations')
                print(f'Using query: {created_query}')
                # Return early if no conversations found
                if total_conversations == 0:
                    return
                # Ask for confirmation before proceeding
                if not click.confirm('Do you want to proceed with downloading?'):
                    return
            
            # Yield each conversation
            for conversation in data['_embedded']['conversations']:
                processed_conversations += 1
                # Fetch full conversation details with threads
                conv_details = self.get_conversation_details(conversation['id'])
                print(f'Processing conversation {processed_conversations}/{total_conversations}', end='\r')
                yield conv_details
            
            # Check if there are more pages
            if data['page']['number'] >= data['page']['totalPages']:
                print()  # New line after progress
                break
                
            params['page'] += 1

    def get_conversation_details(self, conversation_id: int) -> Dict[str, Any]:
        """
        Fetch detailed conversation data including threads.
        
        Args:
            conversation_id: The ID of the conversation to fetch
            
        Returns:
            Dict containing conversation details with threads
        """
        params = {'embed': 'threads'}
        
        while True:
            response = self.session.get(
                f'{self.BASE_URL}/conversations/{conversation_id}',
                params=params
            )
            response = self._handle_response(response)
            
            if response.status_code == 429:  # Rate limit hit
                retry_after = int(response.headers.get('Retry-After', 60))
                time.sleep(retry_after)
                continue
                
            response.raise_for_status()
            return response.json()

    def list_tags(self) -> list[Dict[str, Any]]:
        """
        Get all tags used across all inboxes.
        
        Returns:
            List of tag objects containing id, name, slug, color, and ticket count
        """
        params = {'page': 1}
        all_tags = []

        while True:
            response = self.session.get(f'{self.BASE_URL}/tags', params=params)
            response = self._handle_response(response)
            
            if response.status_code == 429:  # Rate limit hit
                retry_after = int(response.headers.get('Retry-After', 60))
                time.sleep(retry_after)
                continue
                
            response.raise_for_status()
            data = response.json()
            
            all_tags.extend(data['_embedded']['tags'])
            
            # Check if there are more pages
            if data['page']['number'] >= data['page']['totalPages']:
                break
                
            params['page'] += 1
            
        return all_tags

@cli.command(name='list-tags')
def list_tags_command():
    """List all available tags"""
    # Get required credentials from environment
    client_id = os.getenv('HELPSCOUT_APP_ID')
    client_secret = os.getenv('HELPSCOUT_APP_SECRET')
    
    if not all([client_id, client_secret]):
        raise ValueError(
            'HELPSCOUT_APP_ID and HELPSCOUT_APP_SECRET '
            'environment variables are required'
        )

    # Initialize API client
    api = HelpScoutAPI(client_id, client_secret)
    
    try:
        tags = api.list_tags()
        print(f'\nFound {len(tags)} tags:\n')
        print(tags)
        
        # Print tags in a formatted table
        print(f'{"NAME":<30} {"SLUG":<30} {"COUNT":>8}')
        print('-' * 70)
        for tag in sorted(tags, key=lambda x: x['name'].lower()):
            print(f'{tag["name"]:<30} {tag["slug"]:<30} {tag["ticketCount"]:>8}')
            
    except requests.exceptions.RequestException as e:
        print(f'Error fetching tags: {e}')
        raise

@cli.command(name='token')
def print_token():
    """Print the current access token"""
    client_id = os.getenv('HELPSCOUT_APP_ID')
    client_secret = os.getenv('HELPSCOUT_APP_SECRET')
    
    if not all([client_id, client_secret]):
        raise ValueError(
            'HELPSCOUT_APP_ID and HELPSCOUT_APP_SECRET '
            'environment variables are required'
        )

    api = HelpScoutAPI(client_id, client_secret)
    print(api.access_token)

# Rename existing main to fetch_conversations and add it as a command
@cli.command(name='fetch')
@click.option(
    '--from',
    'created_from',
    required=True,
    type=click.DateTime(),
    help='Filter conversations created after this date (format: YYYY-MM-DD)'
)
@click.option(
    '--to',
    'created_to',
    required=False,
    type=click.DateTime(),
    help='Filter conversations created before this date (format: YYYY-MM-DD)'
)
@click.option(
    '--tag',
    'tags',
    multiple=True,
    help='Filter by tag. Can be specified multiple times. Supports quoted strings.'
)
@click.option(
    '--status',
    type=click.Choice(['all', 'active', 'closed', 'open', 'pending', 'spam'], 
                      case_sensitive=False),
    default='all',
    help='Filter by conversation status'
)
@click.option(
    '--output-dir',
    default='conversations',
    help='Directory to save conversation JSON files',
    type=click.Path()
)
def fetch_conversations(
    created_from: datetime,
    created_to: Optional[datetime],
    tags: tuple[str, ...],
    status: str,
    output_dir: str
):
    """Fetch and save Help Scout conversations within the specified date range."""
    # Get required credentials from environment
    client_id = os.getenv('HELPSCOUT_APP_ID')
    client_secret = os.getenv('HELPSCOUT_APP_SECRET')
    
    if not all([client_id, client_secret]):
        raise ValueError(
            'HELPSCOUT_APP_ID and HELPSCOUT_APP_SECRET '
            'environment variables are required'
        )

    # Initialize API client
    api = HelpScoutAPI(client_id, client_secret)
    
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    try:
        # Convert tags tuple to list if any tags were provided
        tag_list = list(tags) if tags else None
        
        # Print filter information
        print(f'Fetching conversations:')
        print(f'  From: {created_from.isoformat()}')
        if created_to:
            print(f'  To: {created_to.isoformat()}')
        if tag_list:
            print(f'  Tags: {", ".join(tag_list)}')
        print(f'  Status: {status}')
        print()
        
        saved_count = 0
        # Fetch and save conversations
        for conversation in api.get_conversations(
            created_from=created_from,
            created_to=created_to,
            tags=tag_list,
            status=status
        ):
            # Save each conversation to a JSON file
            filename = f'{output_dir}/conversation_{conversation["id"]}.json'
            with open(filename, 'w', encoding='utf-8') as f:
                json.dump(conversation, f, indent=2, ensure_ascii=False)
            
            saved_count += 1
            
        print(f'\nSuccessfully saved {saved_count} conversations to {output_dir}/')
            
    except requests.exceptions.RequestException as e:
        print(f'Error fetching conversations: {e}')
        raise

@cli.command(name='export')
@click.option(
    '--from',
    'created_from',
    required=True,
    type=click.DateTime(),
    help='Filter conversations created after this date (format: YYYY-MM-DD)'
)
@click.option(
    '--to',
    'created_to',
    required=False,
    type=click.DateTime(),
    help='Filter conversations created before this date (format: YYYY-MM-DD)'
)
@click.option(
    '--tag',
    'tags',
    multiple=True,
    help='Filter by tag. Can be specified multiple times. Supports quoted strings.'
)
@click.option(
    '--status',
    type=click.Choice(['all', 'active', 'closed', 'open', 'pending', 'spam'], 
                      case_sensitive=False),
    default='all',
    help='Filter by conversation status'
)
def export_conversations(
    created_from: datetime,
    created_to: Optional[datetime],
    tags: tuple[str, ...],
    status: str
):
    """Fetch, save, and analyze Help Scout conversations in one step."""
    # Get credentials
    client_id, client_secret = get_credentials()

    # Initialize API client
    api = HelpScoutAPI(client_id, client_secret)
    
    # Create timestamped output directory
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    tag_suffix = "_".join(tags).replace(" ", "-")[:30] if tags else ""
    
    # Create parent exports directory if it doesn't exist
    exports_dir = "exports"
    os.makedirs(exports_dir, exist_ok=True)
    
    # Create subdirectory for this export
    if tag_suffix:
        output_dir = f"{exports_dir}/{timestamp}_{tag_suffix}"
    else:
        output_dir = f"{exports_dir}/{timestamp}"
    
    os.makedirs(output_dir, exist_ok=True)
    
    # Print filter information
    print(f'Exporting conversations:')
    print(f'  From: {created_from.isoformat()}')
    if created_to:
        print(f'  To: {created_to.isoformat()}')
    if tags:
        print(f'  Tags: {", ".join(tags)}')
    print(f'  Status: {status}')
    print()
    
    # Fetch and save conversations
    saved_count = 0
    for conversation in api.get_conversations(
        created_from=created_from,
        created_to=created_to,
        tags=list(tags) if tags else None,
        status=status
    ):
        # Save each conversation to a JSON file
        filename = f'{output_dir}/conversation_{conversation["id"]}.json'
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(conversation, f, indent=2, ensure_ascii=False)
        
        saved_count += 1
    
    if saved_count == 0:
        print("No conversations found matching your criteria.")
        return
        
    print(f'\nSaved {saved_count} conversations to {output_dir}/')
    
    # Generate CSV summary
    csv_filename = f"{output_dir}/summary.csv"
    
    # Prepare CSV headers for conversation-level summary
    headers = [
        'conversation_id',
        'subject',
        'shop_name',
        'email',
        'tags',
        'created_at',
        'closed_at',
        'conversation_text'
    ]
    
    # Collect conversation summaries
    conversation_summaries = []
    
    for filename in os.listdir(output_dir):
        if not filename.endswith('.json'):
            continue
            
        filepath = os.path.join(output_dir, filename)
        
        with open(filepath, 'r', encoding='utf-8') as f:
            conversation = json.load(f)
            
        # Get conversation info
        conv_id = conversation.get('id')
        subject = conversation.get('subject', 'No Subject')
        primary_customer = conversation.get('primaryCustomer', {})
        shop_name = primary_customer.get('first', 'Unknown Shop')
        email = primary_customer.get('email', 'No Email')
        created_at = conversation.get('createdAt', '')
        closed_at = conversation.get('closedAt', '')
        
        # Get tags
        tags = conversation.get('tags', [])
        tag_names = [tag.get('tag', '') for tag in tags] if tags else []
        tags_str = ', '.join(tag_names)
        
        # Get threads
        threads = conversation.get('_embedded', {}).get('threads', [])
        
        # Build conversation text with all messages in chronological order
        conversation_parts = []
        
        for thread in threads:
            # Skip certain thread types
            if thread.get('type') in ['lineitem', 'note']:
                continue
            
            # Get message date
            created_at_str = thread.get('createdAt', '')
            if created_at_str:
                # Format date for readability
                message_date = datetime.fromisoformat(created_at_str.replace('Z', '+00:00'))
                date_str = message_date.strftime("%Y-%m-%d %H:%M")
            else:
                date_str = "Unknown date"
            
            # Determine message type by checking creator type
            created_by = thread.get('createdBy', {})
            sender_type = 'Customer' if created_by.get('type') == 'customer' else 'Support'
            
            # Get message body and clean HTML
            body = thread.get('body', '')
            # Parse HTML and get text only
            soup = BeautifulSoup(body, 'html.parser')
            # Get text and normalize whitespace
            clean_body = ' '.join(soup.get_text().split())
            
            # Add formatted message to conversation parts
            conversation_parts.append(f"[{date_str}] {sender_type}: {clean_body}")
        
        # Join all messages with newlines
        full_conversation_text = "\n\n".join(conversation_parts)
        
        # Add to summaries
        conversation_summaries.append({
            'conversation_id': conv_id,
            'subject': subject,
            'shop_name': shop_name,
            'email': email,
            'tags': tags_str,
            'created_at': created_at,
            'closed_at': closed_at,
            'conversation_text': full_conversation_text
        })
    
    # Sort conversations by creation date
    conversation_summaries.sort(key=lambda x: x['created_at'] if x['created_at'] else '')
    
    # Write to CSV
    with open(csv_filename, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        writer.writerows(conversation_summaries)
    
    print(f'Created summary CSV with {len(conversation_summaries)} conversations: {csv_filename}')
    print(f'\nAnalysis complete! You can find all files in the {output_dir}/ directory.')

@cli.command(name='setup')
def setup_credentials():
    """Interactive setup to configure your Help Scout API credentials."""
    print("Help Scout API Setup Wizard")
    print("==========================")
    print("\nThis wizard will help you set up your Help Scout API credentials.")
    print("You'll need to create an app in your Help Scout account to get these credentials.")
    print("\nFollow these steps:")
    print("1. Log in to your Help Scout account")
    print("2. Go to 'Your Profile' > 'My Apps'")
    print("3. Click 'Create My App'")
    print("4. Give your app a name (e.g., 'Help Scout Exporter')")
    print("5. Copy the 'App ID' and 'App Secret'")
    
    print("\nNow, enter your credentials:")
    app_id = click.prompt("App ID", hide_input=False)
    app_secret = click.prompt("App Secret", hide_input=True)
    
    # Create .env file
    with open('.env', 'w') as f:
        f.write(f"HELPSCOUT_APP_ID={app_id}\n")
        f.write(f"HELPSCOUT_APP_SECRET={app_secret}\n")
    
    print("\nCredentials saved to .env file!")
    print("You can now use the other commands like 'fetch' and 'summarize'.")
    
    # Test the credentials
    try:
        api = HelpScoutAPI(app_id, app_secret)
        print("\n✅ Credentials verified successfully!")
    except Exception as e:
        print(f"\n❌ Error verifying credentials: {e}")
        print("Please check your App ID and App Secret and try again.")

def get_credentials():
    """Get API credentials and guide users if they're missing."""
    client_id = os.getenv('HELPSCOUT_APP_ID')
    client_secret = os.getenv('HELPSCOUT_APP_SECRET')
    
    if not all([client_id, client_secret]):
        print("❌ Help Scout API credentials not found!")
        print("Please run 'python main.py setup' to configure your credentials.")
        print("\nIf you've already set up credentials, make sure your .env file exists and contains:")
        print("HELPSCOUT_APP_ID=your_app_id")
        print("HELPSCOUT_APP_SECRET=your_app_secret")
        sys.exit(1)
        
    return client_id, client_secret

if __name__ == '__main__':
    cli()
