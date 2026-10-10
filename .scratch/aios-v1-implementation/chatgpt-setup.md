# Separate ChatGPT setup prerequisites

Owner approved preparation, separate from feature delivery. The CLI prepared stable, non-secret host registration at C:/Users/mraar/.developer-os-model-auth/registration.json, outside candidate and controller state. It stored no credentials and enabled no delivery.

Follow OpenAI's [Sign in with ChatGPT flow](https://developers.openai.com/siwc/token-sharing-open-source/sign-in): implement a trusted host broker using dynamic_agent_client, stable ext_agent_host_id and Developer OS agent name, PKCE/state/nonce, exact loopback callback, and the issued client ID for exchange. Verify ID-token signature, issuer, audience, expiry and nonce before encrypted host-only credential storage. Scope direct resource invocation to https://api.openai.com/v1; retain refresh tokens outside the worker.

Then qualify the [Codex app-server integration](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server) through a trusted model-only relay. A worker must receive only a scoped revocable delivery capability. Independently test endpoint restrictions, VM credential exclusion, usage approval/exhaustion, revocation and completed authorized subscription inference. Current host canaries do not prove these. Browser authorization and the broker are not implemented yet. No paid API fallback is authorized.

macOS 14+ Apple-silicon qualification is blocked: owner confirmed no authorized Mac is available.
