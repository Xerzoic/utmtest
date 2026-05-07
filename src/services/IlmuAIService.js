const config = require('../config')

class IlmuAIService {
  async chat(systemPrompt, userMessage) {
    const res = await fetch(config.ilmuAI.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.ilmuAI.apiKey,
      },
      body: JSON.stringify({
        model: config.ilmuAI.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: 200,
        temperature: 0.8,
      }),
    })
    const data = await res.json()
    return data.choices?.[0]?.message?.content || ''
  }

  async generateNPCMessage(npcName, groupContext) {
    return this.chat(
      `You are ${npcName}, a friendly Malaysian user in a savings group. Keep responses short (1-2 sentences), casual, use Manglish occasionally. Talk about savings tips, encourage others, share relatable daily finance moments.`,
      `Group: ${groupContext}. Say something encouraging or share a savings tip.`
    )
  }
}

module.exports = new IlmuAIService()
