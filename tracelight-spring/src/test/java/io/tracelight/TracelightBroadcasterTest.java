package io.tracelight;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TracelightBroadcasterTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void snapshotIncludesEdgeTimingWhenSampled() throws Exception {
        GraphRegistry registry = new GraphRegistry();
        registry.recordHit("a", GraphRegistry.ENTRY_ID, 10_000_000L); // 10 ms
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 0);

        JsonNode edge = firstEdgeOfSnapshot(broadcaster);

        assertThat(edge.get("samples").asLong()).isEqualTo(1);
        assertThat(edge.get("min").asDouble()).isEqualTo(10.0);
        assertThat(edge.get("avg").asDouble()).isEqualTo(10.0);
        assertThat(edge.get("max").asDouble()).isEqualTo(10.0);
    }

    @Test
    void snapshotOmitsTimingWhenNoSamples() throws Exception {
        GraphRegistry registry = new GraphRegistry();
        registry.recordHit("a", GraphRegistry.ENTRY_ID); // no timing
        TracelightBroadcaster broadcaster = new TracelightBroadcaster(registry, 0);

        JsonNode edge = firstEdgeOfSnapshot(broadcaster);

        assertThat(edge.has("min")).isFalse();
        assertThat(edge.has("avg")).isFalse();
        assertThat(edge.has("samples")).isFalse();
    }

    private JsonNode firstEdgeOfSnapshot(TracelightBroadcaster broadcaster) throws Exception {
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.isOpen()).thenReturn(true);
        ArgumentCaptor<TextMessage> captor = ArgumentCaptor.forClass(TextMessage.class);

        broadcaster.register(session);

        verify(session).sendMessage(captor.capture());
        JsonNode snapshot = mapper.readTree(captor.getValue().getPayload());
        return snapshot.get("edges").get(0);
    }
}
