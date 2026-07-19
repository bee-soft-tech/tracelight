package io.beesofttech.tracelight.demo;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class DemoController {

    private final OrderService orderService;
    private final CatalogService catalogService;

    public DemoController(OrderService orderService, CatalogService catalogService) {
        this.orderService = orderService;
        this.catalogService = catalogService;
    }

    @PostMapping("/order")
    public ResponseEntity<Map<String, Object>> order(@RequestBody Order order) {
        if (!orderService.validate(order)) {
            return ResponseEntity.badRequest().body(Map.of("status", "rejected"));
        }
        orderService.checkInventory(order);
        orderService.charge(order);
        orderService.ship(order);
        return ResponseEntity.ok(Map.of("status", "ok"));
    }

    @GetMapping("/search")
    public Map<String, Object> search(@RequestParam(required = false, defaultValue = "") String q) {
        catalogService.search(q);
        return Map.of("status", "ok");
    }
}
