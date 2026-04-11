if (punishment === 'timeout' || punishment === 'ban') {
              const secs = mod.timeoutSeconds || 60;
              // Try broadcaster token first, fall back to any mod token that has the scope
              let token;
              let moderatorId = user.id;
              try {
                token = await getValidToken(user.id);
              } catch(e) {}
              const targetData = await helixGet(`/users?login=${tags.username}`, token);
              const targetId = targetData.data?.[0]?.id;
              if (targetId) {
                const body = punishment === 'ban'
                  ? { data: { user_id: targetId, reason: 'Banned word detected' } }
                  : { data: { user_id: targetId, duration: secs, reason: 'Banned word detected' } };
                const banRes = await fetch(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${user.id}&moderator_id=${moderatorId}`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}`, 'Client-Id': process.env.TWITCH_CLIENT_ID, 'Content-Type': 'application/json' },
                  body: JSON.stringify(body)
                });
                const banData = await banRes.json();
                console.log(`[${channelName}] Ban/timeout result:`, JSON.stringify(banData));
              }
            } else {
              await client.deleteMessage(channel, tags.id);
            }
