# Pure ROR Matcher

A web application for linking external organizations in Elsevier Pure to [ROR (Research Organization Registry)](https://ror.org/) identifiers. The tool provides an interactive interface for reviewing and approving ROR matches, with gamification elements to make the data curation process more engaging.

## Features

- **Automated ROR Matching**: Uses the ROR API's affiliation endpoint to find potential matches for Pure external organizations
- **Interactive Review**: Browse random unlinked organizations and review ROR candidates with match scores
- **Match Type Visualization**: Color-coded display showing match types (EXACT, PHRASE, FUZZY, etc.)
- **Confirmation Workflow**: Review and confirm matches before writing to Pure
- **Gamification**: Earn points for linking organizations, with levels and progress tracking
- **Link History**: Track your linking activity with timestamps and scores
- **Smart Filtering**: Only shows organizations that are in "forApproval" or "approved" status and don't already have ROR identifiers

## How It Works

1. The application fetches a random external organization from your Pure instance that:
   - Is in "forApproval" or "approved" workflow status
   - Does not already have a ROR identifier

2. It queries the ROR API's affiliation endpoint using the organization's name

3. ROR returns up to 10 candidate matches with:
   - Match scores (0.0 - 1.0)
   - Match types (EXACT, PHRASE, COMMON TERMS, FUZZY, HEURISTICS, ACRONYM)
   - "Chosen" flag indicating ROR's recommended match
   - Alternative names and aliases

4. You review the candidates and select the best match

5. Upon confirmation, the application:
   - Fetches the latest version of the organization from Pure
   - Appends the ROR identifier to the existing identifiers
   - Updates the organization in Pure via PUT request
   - Awards points based on match confidence

## Prerequisites

- Node.js (version 18 or higher)
- npm or yarn
- Access to an Elsevier Pure instance with API credentials
- Pure API key with permissions to read and write external organizations

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/pure-ror-matcher.git
cd pure-ror-matcher
```

2. Install dependencies:
```bash
npm install
```

3. Create a configuration file by copying the example:
```bash
cp src/config.example.ts src/config.ts
```

4. Edit `src/config.ts` with your Pure instance details:
```typescript
export const PURE_BASE_URL = "https://your-institution.pure.elsevier.com/ws/api";
export const PURE_API_KEY = "your-api-key-here";

export const ROR_TYPE = {
  uri: "/dk/atira/pure/ueoexternalorganisation/ueoexternalorganisationsources/ror",
  term: { en_GB: "ROR ID", da_DK: "ROR ID" },
};
```

**Important**: The `config.ts` file is gitignored and should never be committed to version control.

## Configuration

### Pure API Settings

- **PURE_BASE_URL**: The base URL of your Pure API endpoint (typically `https://your-institution.pure.elsevier.com/ws/api`)
- **PURE_API_KEY**: Your Pure API key with read/write permissions for external organizations

### ROR Identifier Type

The `ROR_TYPE` object defines how ROR identifiers are stored in Pure. You may need to adjust the `uri` path to match your Pure instance's identifier type configuration.

### Vite Proxy Configuration

The `vite.config.ts` includes a proxy configuration to handle CORS issues during development. Update the target URL to match your Pure instance:

```typescript
server: {
  proxy: {
    '/ws/api': {
      target: 'https://your-institution.pure.elsevier.com',
      changeOrigin: true,
      secure: false,
    },
  },
},
```

## Usage

### Development Mode

Start the development server:
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### Production Build

Build the application for production:
```bash
npm run build
```

Preview the production build:
```bash
npm run preview
```

### Using the Interface

1. **Load Organization**: Click "Next random org" to load an eligible external organization from Pure

2. **Review Candidates**: Examine the ROR candidates displayed with:
   - Organization name and aliases
   - Country information
   - Match type (color-coded borders)
   - Match score and "chosen" status

3. **Select Match**: Use the radio button to select the best matching ROR organization

4. **Confirm**: Click "Link selected ROR" to open the confirmation modal

5. **Review and Link**: Verify the details and confirm to write the ROR identifier to Pure

6. **Track Progress**: Monitor your points and level in the progress bar at the top

### Match Type Color Coding

- **Emerald**: EXACT match
- **Blue**: PHRASE match
- **Amber**: COMMON TERMS match
- **Fuchsia**: FUZZY match
- **Teal**: HEURISTICS match
- **Cyan**: ACRONYM match

## Gamification System

The application includes a point-based progression system to encourage consistent curation:

### Points Awarded
- High confidence match (score ≥ 0.8): 10 points
- Medium confidence match (score ≥ 0.6): 5 points
- Low confidence match: 1 point

### Levels
1. **Unstructured Newbie 👶** (0 pts)
2. **Metadata Apprentice 🧙‍♀️** (250 pts)
3. **Pure Data Influencer 🧑‍💻** (500 pts)
4. **Persistent Identifier Pro 😎** (700 pts)
5. **Final Boss of Metadata 👹** (900 pts)

Progress and history are stored in browser localStorage and persist across sessions.

## Data Model

### Pure External Organization Structure
```typescript
{
  uuid: string;
  version: string;
  name: { [locale: string]: string };
  identifiers: Array<{
    typeDiscriminator: "ClassifiedId";
    id: string;
    type: {
      uri: string;
      term: { [locale: string]: string };
    };
  }>;
  address?: {
    country?: {
      term?: { [locale: string]: string };
    };
  };
  workflow?: {
    step?: "forApproval" | "approved";
  };
}
```

## API Endpoints Used

### Pure API
- `GET /external-organizations?size=1&offset={offset}` - Fetch organizations
- `GET /external-organizations/{uuid}` - Get specific organization
- `PUT /external-organizations/{uuid}` - Update organization with ROR identifier

### ROR API
- `GET https://api.ror.org/organizations?affiliation={name}` - Search for matching organizations

## Rate Limiting

The application implements rate limiting (350ms between requests) to avoid overwhelming the Pure API. This is configured in the `useLimitedFetch` hook.

## Browser Compatibility

The application uses modern JavaScript features and requires:
- ES2022 support
- localStorage API
- Fetch API

Tested in recent versions of Chrome, Firefox, Safari, and Edge.

## Security Considerations

- **Never commit** your `config.ts` file with real API credentials
- The API key is sent in request headers and visible in browser dev tools
- Consider implementing proper authentication for production deployments
- The application is designed for internal use by trusted curators

## Troubleshooting

### "Failed to fetch organization"
- Verify your Pure API key has correct permissions
- Check that the Pure base URL is correct
- Ensure your Pure instance is accessible from your network

### "No eligible external organizations found"
- All organizations may already have ROR identifiers
- Check that organizations exist in "forApproval" or "approved" status

### CORS Errors
- Ensure the Vite proxy is configured correctly
- Verify the Pure API allows requests from your domain

## Technology Stack

- **React** 19.1.1 - UI framework
- **TypeScript** 5.8.3 - Type safety
- **Vite** 5.4.10 - Build tool and dev server
- **Tailwind CSS** 3.4.13 - Styling
- **ROR API** - Organization matching

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

[Add your license here]

## Acknowledgments

- [ROR (Research Organization Registry)](https://ror.org/) for providing the organization matching API
- [Elsevier Pure](https://www.elsevier.com/solutions/pure) for the CRIS platform

## Support

For issues, questions, or suggestions, please open an issue on the GitHub repository.
