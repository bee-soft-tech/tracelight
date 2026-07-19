package io.beesofttech.tracelight;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;

class TracelightReactiveControllerTest {

    @Test
    void resetDelegatesToBroadcaster() {
        TracelightBroadcaster broadcaster = mock(TracelightBroadcaster.class);
        TracelightReactiveController controller = new TracelightReactiveController(broadcaster);

        StepVerifier.create(controller.reset()).verifyComplete();

        verify(broadcaster).reset();
    }
}
