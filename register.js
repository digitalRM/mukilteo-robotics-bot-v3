import 'dotenv/config';

const token = process.env.DISCORD_TOKEN;
const appId = process.env.DISCORD_APP_ID;

if (!token || !appId) {
  console.error('Please define DISCORD_TOKEN and DISCORD_APP_ID in .env');
  process.exit(1);
}

const commands = [
  {
    name: 'test',
    description: 'Basic test command',
    type: 1,
  },
  {
    name: 'competitions',
    description: 'Show upcoming competitions for Mukilteo Robotics teams',
    type: 1,
  }
];

async function registerCommands() {
  const url = `https://discord.com/api/v10/applications/${appId}/commands`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${token}`,
    },
    method: 'PUT',
    body: JSON.stringify(commands),
  });

  if (response.ok) {
    console.log('Registered all commands');
  } else {
    console.error('Error registering commands');
    const text = await response.text();
    console.error(text);
  }
}

registerCommands();

