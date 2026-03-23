import crypto from 'crypto';

export default async function handler(req, res) {

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { email, automation_id } = req.body;

    if (!email || !email.includes('@')) {
        return res.status(400).json({ error: 'Valid email required' });
    }

    const PUBLICATION_ID = process.env.BEEHIIV_PUBLICATION_ID;
    const API_KEY = process.env.BEEHIIV_API_KEY;
    const AUTOMATION_ID = automation_id || process.env.BEEHIIV_AUTOMATION_ID;
    const FB_PIXEL_ID = process.env.FACEBOOK_PIXEL_ID;
    const FB_ACCESS_TOKEN = process.env.FACEBOOK_ACCESS_TOKEN;

    const eventId = crypto.randomUUID();
    const hashedEmail = crypto
        .createHash('sha256')
        .update(email.toLowerCase().trim())
        .digest('hex');

    try {

        // STEP 1 — Create Beehiiv subscription
        const subResponse = await fetch(
            `https://api.beehiiv.com/v2/publications/${PUBLICATION_ID}/subscriptions`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`
                },
                body: JSON.stringify({
                    email: email,
                    reactivate_existing: true,
                    send_welcome_email: false
                })
            }
        );

        const subData = await subResponse.json();

        if (!subResponse.ok) {
            console.error('Beehiiv subscription error:', subData);
            return res.status(500).json({ error: 'Subscription failed' });
        }

        // STEP 2 — Wait then enrol in automation
        await new Promise(resolve => setTimeout(resolve, 1500));

        const journeyResponse = await fetch(
            `https://api.beehiiv.com/v2/publications/${PUBLICATION_ID}/automations/${AUTOMATION_ID}/journeys`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`
                },
                body: JSON.stringify({
                    email: email,
                    double_opt_override: 'off'
                })
            }
        );

        const journeyData = await journeyResponse.json();

        if (!journeyResponse.ok) {
            const alreadyEnrolled = journeyData?.errors?.[0]?.code?.includes('ALREADY_ENROLLED');
            if (!alreadyEnrolled) {
                console.error('Beehiiv journey error:', journeyData);
            }
        }

        // STEP 3 — Fire Lead_Subscribe to Facebook Conversions API
        if (FB_PIXEL_ID && FB_ACCESS_TOKEN) {
            try {
                const fbResponse = await fetch(
                    `https://graph.facebook.com/v19.0/${FB_PIXEL_ID}/events?access_token=${FB_ACCESS_TOKEN}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            data: [{
                                event_name: 'Lead_Subscribe',
                                event_time: Math.floor(Date.now() / 1000),
                                event_id: eventId,
                                action_source: 'website',
                                user_data: {
                                    em: [hashedEmail]
                                }
                            }]
                        })
                    }
                );

                const fbData = await fbResponse.json();
                if (!fbResponse.ok) {
                    console.error('Facebook CAPI error:', fbData);
                } else {
                    console.log('Facebook CAPI Lead_Subscribe fired:', fbData);
                }
            } catch (fbErr) {
                console.error('Facebook CAPI exception:', fbErr);
            }
        }

        return res.status(200).json({ success: true, event_id: eventId });

    } catch (err) {
        console.error('Server error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
}
