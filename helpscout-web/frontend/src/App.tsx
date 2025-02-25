import { useState, useEffect, useRef } from 'react'
import './App.css'

// Types
interface AuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface Conversation {
  id: number;
  number: number;
  subject: string;
  status: string;
  createdAt: string;
  closedAt?: string;
  primaryCustomer: {
    id: number;
    first: string;
    email: string;
  };
  tags: Array<{
    id: number;
    tag?: string;
    name?: string;
    slug?: string;
  }>;
  _embedded?: {
    threads: Array<{
      id: number;
      type: string;
      status: string;
      body: string;
      createdAt: string;
      createdBy: {
        id: number;
        type: string;
        first: string;
        email: string;
      };
    }>;
  };
}

interface Tag {
  id: number;
  name: string;
  slug: string;
  color?: string;
  count: number;
}

// Add progress state and WebSocket connection
interface ProgressUpdate {
  message: string;
  data?: {
    progress?: number;
    page?: number;
    totalPages?: number;
    conversationsCount?: number;
    total?: number;
    complete?: boolean;
    error?: string;
  };
  timestamp: string;
}

function App() {
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [token, setToken] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [status, setStatus] = useState('all')

  const [availableTags, setAvailableTags] = useState<Tag[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [csvData, setCsvData] = useState('')

  // Add a new state for "remember me" checkbox
  const [rememberCredentials, setRememberCredentials] = useState(false);

  // Add state for progress updates
  const [progressUpdates, setProgressUpdates] = useState<ProgressUpdate[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const progressRef = useRef<HTMLDivElement>(null);

  // WebSocket connection
  const wsRef = useRef<WebSocket | null>(null);

  // Add state for confirmation
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [conversationCount, setConversationCount] = useState(0);
  const [exportParams, setExportParams] = useState<URLSearchParams | null>(null);

  // Update the useEffect to load credentials on startup
  useEffect(() => {
    const loadCredentials = async () => {
      try {
        const response = await fetch('http://localhost:3001/api/stored-credentials');
        if (response.ok) {
          const data = await response.json();
          if (data.appId) {
            setAppId(data.appId);
            setAppSecret(data.appSecret || '');
            setRememberCredentials(true);
          }
        }
      } catch (err) {
        console.error('Failed to load stored credentials:', err);
      }
    };

    loadCredentials();
  }, []);

  // Initialize WebSocket connection
  useEffect(() => {
    if (isAuthenticated) {
      // Connect to WebSocket server
      const ws = new WebSocket(`ws://${window.location.hostname}:3001`);

      ws.onopen = () => {
        console.log('WebSocket connection established');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'progress') {
            setProgressUpdates(prev => [...prev, {
              message: data.message,
              data: data.data,
              timestamp: data.timestamp
            }]);

            // Update progress bar if progress data is available
            if (data.data && typeof data.data.progress === 'number') {
              setExportProgress(data.data.progress);
            }

            // Auto-scroll to the bottom of the progress container
            if (progressRef.current) {
              progressRef.current.scrollTop = progressRef.current.scrollHeight;
            }

            // If export is complete, set isExporting to false
            if (data.data && data.data.complete) {
              setIsExporting(false);
            }
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('WebSocket connection closed');
      };

      wsRef.current = ws;

      // Clean up WebSocket connection on unmount
      return () => {
        ws.close();
      };
    }
  }, [isAuthenticated]);

  // Handle authentication
  const handleAuthenticate = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const response = await fetch('http://localhost:3001/api/auth', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ appId, appSecret })
      })

      if (!response.ok) {
        throw new Error('Authentication failed')
      }

      const data: AuthResponse = await response.json()
      setToken(data.access_token)
      setIsAuthenticated(true)

      // Save credentials if remember is checked
      if (rememberCredentials) {
        await fetch('http://localhost:3001/api/store-credentials', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ appId, appSecret, remember: true })
        });
      }

      // Fetch tags with counts in a single call
      await fetchTagsWithCounts(data.access_token)
    } catch (err) {
      console.error('Authentication error:', err)
      setError('Failed to authenticate. Please check your credentials.')
    } finally {
      setIsLoading(false)
    }
  }

  // Replace the separate fetchTags and fetchTagCounts functions with a single function
  const fetchTagsWithCounts = async (accessToken: string) => {
    try {
      setIsLoading(true);

      const response = await fetch('http://localhost:3001/api/tags-with-counts', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch tags');
      }

      const data = await response.json();
      console.log('Tags with counts response:', data);

      // Make sure we're setting the tags correctly
      if (data._embedded && Array.isArray(data._embedded.tags)) {
        // Map the tags to ensure we have the correct properties
        const processedTags = data._embedded.tags.map((tag: any) => ({
          id: tag.id,
          name: tag.name || `Tag ${tag.id}`,
          slug: tag.slug || '',
          color: tag.color,
          count: tag.count || 0
        }));

        console.log('Processed tags with counts:', processedTags);
        setAvailableTags(processedTags);
      } else {
        console.error('Unexpected tags response format:', data);
        setError('Failed to parse tags data');
      }
    } catch (err) {
      console.error('Error fetching tags with counts:', err);
      setError('Failed to fetch tags. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle tag selection
  const handleTagChange = (tagSlug: string) => {
    if (!tagSlug) {
      console.error('Attempted to toggle undefined tag slug');
      return;
    }

    console.log('Tag clicked:', tagSlug);
    console.log('Current selected tags:', selectedTags);

    // Create a new array based on the current selection
    const newSelectedTags = selectedTags.includes(tagSlug)
      ? selectedTags.filter(t => t !== tagSlug) // Remove if already selected
      : [...selectedTags, tagSlug];             // Add if not selected

    console.log('New selected tags:', newSelectedTags);
    setSelectedTags(newSelectedTags);
  };

  // Update the handleExport function to first count conversations
  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')
    setConversations([])
    setCsvData('')
    setProgressUpdates([])
    setExportProgress(0)

    try {
      // Build query parameters - use from/to for createdAt date range
      const params = new URLSearchParams()
      if (fromDate) params.append('from', fromDate)
      if (toDate) params.append('to', toDate)
      if (selectedTags.length > 0) {
        console.log('Exporting with tags:', selectedTags.join(','))
        params.append('tags', selectedTags.join(','))
      }
      params.append('status', status)

      console.log('Count request params:', params.toString())

      // First, get the count of conversations
      const countResponse = await fetch(`http://localhost:3001/api/count-conversations?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!countResponse.ok) {
        throw new Error('Failed to count conversations')
      }

      const countData = await countResponse.json()
      const count = countData.count || 0

      console.log(`Found ${count} conversations matching criteria`)

      // Store the count and params for confirmation
      setConversationCount(count)
      setExportParams(params)

      // Show confirmation dialog
      setShowConfirmation(true)
    } catch (err) {
      console.error('Export error:', err)
      setError('Failed to count conversations. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  // Add a new function to handle the actual export after confirmation
  const handleConfirmExport = async () => {
    if (!exportParams) return

    setIsLoading(true)
    setShowConfirmation(false)
    setIsExporting(true)

    try {
      const response = await fetch(`http://localhost:3001/api/conversations?${exportParams.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })

      if (!response.ok) {
        throw new Error('Failed to fetch conversations')
      }

      const data = await response.json()
      const fetchedConversations = data._embedded?.conversations || []
      console.log(`Received ${fetchedConversations.length} conversations`)
      setConversations(fetchedConversations)

      // Generate CSV
      if (fetchedConversations.length > 0) {
        generateCSV(fetchedConversations)
      }
    } catch (err) {
      console.error('Export error:', err)
      setError('Failed to export conversations. Please try again.')
      setIsExporting(false)
    } finally {
      setIsLoading(false)
    }
  }

  // Add a function to cancel the export
  const handleCancelExport = () => {
    setShowConfirmation(false)
    setExportParams(null)
    setConversationCount(0)
  }

  // Generate CSV from conversations
  const generateCSV = (conversations: Conversation[]) => {
    // CSV header
    const headers = [
      'Conversation ID',
      'Number',
      'Subject',
      'Status',
      'Created At',
      'Closed At',
      'Customer',
      'Customer Email',
      'Tags',
      'Messages' // Add messages column
    ]

    // CSV rows
    const rows = conversations.map(conv => {
      // Handle tags properly - they might be in different formats
      let tagString = '';
      if (conv.tags && Array.isArray(conv.tags)) {
        // Extract tag names, handling different possible formats
        const tagNames = conv.tags.map(t => {
          // Try different properties that might contain the tag name
          return t.tag || t.name || t.slug || '';
        }).filter(Boolean);
        tagString = tagNames.join(', ');
      }

      // Format all messages into a single string
      let messagesString = '';
      if (conv._embedded?.threads && Array.isArray(conv._embedded.threads)) {
        // Sort threads by createdAt date
        const sortedThreads = [...conv._embedded.threads].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );

        messagesString = sortedThreads
          .map(thread => {
            // Skip system messages and notes if needed
            if (thread.type === 'lineitem') {
              return ''; // Skip system messages
            }

            // Format the message with sender and timestamp
            let prefix = '';
            const timestamp = new Date(thread.createdAt).toLocaleString();

            if (thread.type === 'note') {
              prefix = `[NOTE] ${thread.createdBy?.first || 'Agent'}: `;
            } else if (thread.createdBy?.type === 'customer') {
              prefix = `[CUSTOMER] ${thread.createdBy?.first || 'Customer'}: `;
            } else if (thread.createdBy?.type === 'user') {
              prefix = `[AGENT] ${thread.createdBy?.first || 'Agent'}: `;
            } else {
              prefix = `[SYSTEM]: `;
            }

            // Clean the message body
            const body = thread.body
              ?.replace(/"/g, '""') // Escape quotes for CSV
              .replace(/\n/g, ' ') // Replace newlines with spaces
              .replace(/\r/g, '') // Remove carriage returns
              .trim() || '';

            return `[${timestamp}] ${prefix}${body}`;
          })
          .filter(Boolean) // Remove empty strings
          .join('\n');
      }

      return [
        conv.id,
        conv.number,
        `"${conv.subject?.replace(/"/g, '""') || ''}"`,
        conv.status,
        conv.createdAt,
        conv.closedAt || '',
        `"${conv.primaryCustomer?.first?.replace(/"/g, '""') || ''}"`,
        conv.primaryCustomer?.email || '',
        `"${tagString}"`,
        `"${messagesString}"` // Add messages column
      ];
    });

    // Combine header and rows
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n')

    setCsvData(csvContent)
  }

  // Download CSV
  const downloadCSV = () => {
    if (!csvData) return

    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `helpscout-export-${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Update the logout function to clear credentials if needed
  const handleLogout = async () => {
    if (!rememberCredentials) {
      await fetch('http://localhost:3001/api/store-credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ appId: '', appSecret: '', remember: false })
      });
    }
    setIsAuthenticated(false);
  };

  return (
    <div className="container">
      <h1>Help Scout Conversation Exporter</h1>

      {!isAuthenticated ? (
        <div className="auth-section">
          <form onSubmit={handleAuthenticate}>
            <div className="form-group">
              <label htmlFor="appId">Help Scout App ID</label>
              <input
                type="text"
                id="appId"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="appSecret">Help Scout App Secret</label>
              <input
                type="password"
                id="appSecret"
                value={appSecret}
                onChange={(e) => setAppSecret(e.target.value)}
                required
              />
            </div>

            <div className="form-group checkbox-group">
              <input
                type="checkbox"
                id="rememberMe"
                checked={rememberCredentials}
                onChange={(e) => setRememberCredentials(e.target.checked)}
              />
              <label htmlFor="rememberMe" className="checkbox-label">
                Remember credentials (stores securely on this device)
              </label>
            </div>

            <button type="submit" disabled={isLoading}>
              {isLoading ? 'Connecting...' : 'Connect to Help Scout'}
            </button>
          </form>

          <div className="help-text">
            <h3>How to get Help Scout API credentials</h3>
            <ol>
              <li>Log in to your Help Scout account</li>
              <li>Go to Your Profile &gt; My Apps</li>
              <li>Click "Create My App"</li>
              <li>Give your app a name (e.g., "Help Scout Exporter")</li>
              <li>Copy the App ID and App Secret</li>
            </ol>
          </div>
        </div>
      ) : (
        <div className="export-section">
          <form onSubmit={handleExport}>
            <div className="form-row">
              <div className="form-group half-width">
                <label htmlFor="fromDate">From Date</label>
                <input
                  type="date"
                  id="fromDate"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  required
                />
              </div>

              <div className="form-group half-width">
                <label htmlFor="toDate">To Date (Optional)</label>
                <input
                  type="date"
                  id="toDate"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="status">Status</label>
              <select
                id="status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <div className="form-group">
              <label>Tags (Optional)</label>
              {isLoading ? (
                <div className="loading-tags">Loading tags and counts...</div>
              ) : (
                <div className="tags-container">
                  {availableTags.map(tag => {
                    const isSelected = selectedTags.includes(tag.slug);

                    return (
                      <div
                        key={`tag-item-${tag.id}`}
                        className={`tag-item ${isSelected ? 'selected-tag' : ''}`}
                        onClick={() => handleTagChange(tag.slug)}
                      >
                        <input
                          type="checkbox"
                          id={`tag-${tag.id}`}
                          checked={isSelected}
                          onChange={() => { }} // Empty handler since we handle click on the div
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTagChange(tag.slug);
                          }}
                        />
                        <span className="tag-label">{tag.name}</span>
                        {tag.count > 0 && <span className="tag-count">{tag.count}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <button type="submit" disabled={isLoading}>
              {isLoading ? 'Exporting...' : 'Export Conversations'}
            </button>
          </form>

          {/* Confirmation Dialog */}
          {showConfirmation && (
            <div className="confirmation-dialog">
              <div className="confirmation-content">
                <h3>Confirm Export</h3>
                <p>
                  You are about to export <strong>{conversationCount}</strong> conversations.
                  {conversationCount > 100 && (
                    <span className="warning">
                      This is a large number of conversations and may take some time to process.
                    </span>
                  )}
                </p>
                <p>Do you want to continue?</p>
                <div className="confirmation-buttons">
                  <button
                    onClick={handleConfirmExport}
                    className="confirm-btn"
                    disabled={isLoading}
                  >
                    Yes, Export
                  </button>
                  <button
                    onClick={handleCancelExport}
                    className="cancel-btn"
                    disabled={isLoading}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Progress section */}
          {isExporting && (
            <div className="progress-section">
              <h3>Export Progress</h3>
              <div className="progress-bar-container">
                <div
                  className="progress-bar"
                  style={{ width: `${exportProgress}%` }}
                ></div>
                <div className="progress-text">{exportProgress}%</div>
              </div>
              <div className="progress-updates" ref={progressRef}>
                {progressUpdates.map((update, index) => (
                  <div key={index} className="progress-update">
                    <span className="progress-time">
                      {new Date(update.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="progress-message">{update.message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {conversations.length > 0 && !isExporting && (
            <div className="results-section">
              <p>Found {conversations.length} conversations</p>
              <button onClick={downloadCSV} className="download-btn">
                Download CSV
              </button>

              <div className="conversations-preview">
                <h4>Preview:</h4>
                {conversations.slice(0, 5).map(conv => (
                  <div key={conv.id} className="conversation-item">
                    <h5>{conv.subject}</h5>
                    <p>Customer: {conv.primaryCustomer?.first}</p>
                    <p>Created: {new Date(conv.createdAt).toLocaleString()}</p>
                  </div>
                ))}
                {conversations.length > 5 && <p>...and {conversations.length - 5} more</p>}
              </div>
            </div>
          )}

          <button
            onClick={handleLogout}
            className="logout-btn"
          >
            Disconnect
          </button>
        </div>
      )}

      {error && <div className="error-message">{error}</div>}
    </div>
  )
}

export default App
