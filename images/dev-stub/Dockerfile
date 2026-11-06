# palserver/dev-stub — fake PalServer for UI/agent development on machines
# that can't run the real x86 server (e.g. Apple Silicon: PalServer segfaults
# at world-save creation under Rosetta). Emits believable logs and stays up.
# Use it via: PALSERVER_IMAGE_VANILLA=palserver/dev-stub:latest pnpm dev:agent
FROM alpine:3.21

COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh

EXPOSE 8211/udp 8212/tcp

ENTRYPOINT ["/entrypoint.sh"]
