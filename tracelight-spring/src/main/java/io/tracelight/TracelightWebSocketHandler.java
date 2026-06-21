package io.tracelight;

import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * WebSocket endpoint handler. On connect the client receives a full snapshot;
 * afterwards it receives live {@code topology} / {@code pulse} / {@code reset} events.
 * A client may send {@code "reset"} to zero the counters.
 */
public class TracelightWebSocketHandler extends TextWebSocketHandler {

    private final TracelightBroadcaster broadcaster;

    public TracelightWebSocketHandler(TracelightBroadcaster broadcaster) {
        this.broadcaster = broadcaster;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        broadcaster.register(session);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        broadcaster.remove(session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        String payload = message.getPayload();
        if (payload != null && payload.contains("reset")) {
            broadcaster.reset();
        }
    }
}
