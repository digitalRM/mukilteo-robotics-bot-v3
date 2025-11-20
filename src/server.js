import {
  InteractionType,
  InteractionResponseType,
  verifyKey,
  MessageComponentTypes,
  ButtonStyleTypes,
} from "discord-interactions";

const TEAMS = ["44244N", "44244D", "44244R", "44244C", "44344S"];

async function fetchRobotEvents(url, token) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    console.error(`Failed to fetch from ${url}: ${response.status}`);
    return null;
  }
  return await response.json();
}

async function getTeamId(teamNumber, token) {
  const url = `https://www.robotevents.com/api/v2/teams?number[]=${teamNumber}&myTeams=false&program[]=1&per_page=1`;
  const data = await fetchRobotEvents(url, token);
  if (data && data.data && data.data.length > 0) {
    return { number: teamNumber, id: data.data[0].id };
  }
  console.error(`Could not find ID for team ${teamNumber}`);
  return null;
}

function buildEmbed(events, teamFilter = null) {
  const displayEvents = teamFilter
    ? events.filter((e) => e.teams.includes(teamFilter))
    : events;

  displayEvents.sort((a, b) => new Date(a.start) - new Date(b.start));

  if (displayEvents.length === 0) {
    return {
      title: "Upcoming Competitions",
      description: teamFilter
        ? `No upcoming competitions found for team **${teamFilter}**.`
        : "No upcoming competitions found.",
      color: 0xff0000,
    };
  }

  const fields = displayEvents.slice(0, 10).map((e) => {
    const startDate = new Date(e.start);
    const timestamp = Math.floor(startDate.getTime() / 1000);
    const teamsString = e.teams
      .map((t) => (teamFilter === t ? `__**${t}**__` : t))
      .join(", ");

    return {
      name: e.name,
      value: `\n📍 ${
        e.location?.venue || "Unknown"
      }\n🗓️ <t:${timestamp}:D> (<t:${timestamp}:R>)\n🤖 **Teams:** ${teamsString}\n\n  ----------------------------------------------------------`,
      inline: false,
    };
  });

  return {
    title: teamFilter
      ? `Competitions for ${teamFilter}`
      : "Upcoming Competitions",
    description:
      "Here are the upcoming events for Mukilteo Robotics.\n\n ----------------------------------------------------------",
    color: 0x0099ff,
    fields: fields,
    footer: { text: "Mukilteo Robotics" },
  };
}

function buildButtons(selectedTeam = null) {
  const buttons = TEAMS.map((team) => ({
    type: MessageComponentTypes.BUTTON,
    custom_id: `filter_${team}`,
    style:
      selectedTeam === team
        ? ButtonStyleTypes.SUCCESS
        : ButtonStyleTypes.PRIMARY,
    label: team,
  }));

  buttons.unshift({
    type: MessageComponentTypes.BUTTON,
    custom_id: "filter_all",
    style:
      selectedTeam === null
        ? ButtonStyleTypes.SECONDARY
        : ButtonStyleTypes.SECONDARY,
    label: "Show All",
  });

  const row1 = {
    type: MessageComponentTypes.ACTION_ROW,
    components: buttons.slice(1, 6),
  };
  const row2 = {
    type: MessageComponentTypes.ACTION_ROW,
    components: buttons.slice(0, 1),
  };

  return [row1, row2];
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "POST") {
      const signature = request.headers.get("x-signature-ed25519");
      const timestamp = request.headers.get("x-signature-timestamp");
      const body = await request.text();

      if (!env.DISCORD_PUBLIC_KEY) {
        return new Response("Internal Server Error: Missing Public Key", {
          status: 500,
        });
      }

      const isValidRequest = await verifyKey(
        body,
        signature,
        timestamp,
        env.DISCORD_PUBLIC_KEY
      );

      if (!isValidRequest) {
        return new Response("Bad request signature", { status: 401 });
      }

      const interaction = JSON.parse(body);

      if (interaction.type === InteractionType.PING) {
        return new Response(
          JSON.stringify({ type: InteractionResponseType.PONG }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      const fetchAllData = async () => {
        if (!env.ROBOT_EVENTS_TOKEN) return [];

        const teamIdPromises = TEAMS.map((team) =>
          getTeamId(team, env.ROBOT_EVENTS_TOKEN)
        );
        const teamInfos = await Promise.all(teamIdPromises);
        const validTeamInfos = teamInfos.filter((t) => t !== null);

        if (validTeamInfos.length === 0) return [];

        const today = new Date().toISOString().split("T")[0];
        const eventPromises = validTeamInfos.map((info) => {
          const url = `https://www.robotevents.com/api/v2/events?team[]=${info.id}&start=${today}&per_page=20`;
          return fetchRobotEvents(url, env.ROBOT_EVENTS_TOKEN).then((data) => ({
            team: info.number,
            events: data?.data || [],
          }));
        });

        const results = await Promise.all(eventPromises);

        const eventMap = new Map();

        results.forEach(({ team, events }) => {
          events.forEach((event) => {
            if (!eventMap.has(event.id)) {
              eventMap.set(event.id, { ...event, teams: [] });
            }
            const existing = eventMap.get(event.id);
            if (!existing.teams.includes(team)) {
              existing.teams.push(team);
            }
          });
        });

        return Array.from(eventMap.values());
      };

      if (interaction.type === InteractionType.APPLICATION_COMMAND) {
        const { name } = interaction.data;

        if (name === "competitions") {
          const events = await fetchAllData();
          const embed = buildEmbed(events, null);
          const components = buildButtons(null);

          return new Response(
            JSON.stringify({
              type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
              data: {
                embeds: [embed],
                components: components,
              },
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }
      }

      if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
        const customId = interaction.data.custom_id;

        if (customId.startsWith("filter_")) {
          const teamFilter =
            customId === "filter_all" ? null : customId.replace("filter_", "");

          const events = await fetchAllData();
          const embed = buildEmbed(events, teamFilter);
          const components = buildButtons(teamFilter);

          return new Response(
            JSON.stringify({
              type: InteractionResponseType.UPDATE_MESSAGE,
              data: {
                embeds: [embed],
                components: components,
              },
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        }
      }

      return new Response(JSON.stringify({ error: "Unknown Type" }), {
        status: 400,
      });
    }

    return new Response("Method Not Allowed", { status: 405 });
  },
};
