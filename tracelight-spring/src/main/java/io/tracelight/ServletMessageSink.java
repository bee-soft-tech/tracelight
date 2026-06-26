package io.tracelight;

import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** Servlet WebSocket implementation of {@link MessageSink}: fans a JSON frame out to all sessions. */
public class ServletMessageSink implements MessageSink {

    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();

    public void add(WebSocketSession session) {
        sessions.add(session);
    }

    public void remove(WebSocketSession session) {
        sessions.remove(session);
    }

    @Override
    public void broadcast(String json) {
        for (WebSocketSession session : sessions) {
            send(session, json);
        }
    }

    private void send(WebSocketSession session, String json) {
        if (!session.isOpen()) {
            sessions.remove(session);
            return;
        }
        try {
            // WebSocketSession is not safe for concurrent sends.
            synchronized (session) {
                session.sendMessage(new TextMessage(json));
            }
        } catch (IOException | IllegalStateException ex) {
            sessions.remove(session);
        }
    }
}
