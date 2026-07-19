package io.beesofttech.tracelight;

import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * WebSocket endpoint handler. On connect the client is registered with the {@link ServletMessageSink}
 * and receives a full snapshot; afterwards it receives live events broadcast through the sink.
 * A client may send {@code "reset"} to zero the counters.
 */
public class TracelightWebSocketHandler extends TextWebSocketHandler {

    private final TracelightBroadcaster broadcaster;
    private final ServletMessageSink sink;

    public TracelightWebSocketHandler(TracelightBroadcaster broadcaster, ServletMessageSink sink) {
        this.broadcaster = broadcaster;
        this.sink = sink;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        sink.add(session);
        sink.sendTo(session, broadcaster.snapshotJson());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        sink.remove(session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        String payload = message.getPayload();
        if (payload != null && payload.contains("reset")) {
            broadcaster.reset();
        }
    }
}
