package com.ritmol.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;

@CapacitorPlugin(name = "RitmolHealth")
public class RitmolHealthPlugin extends Plugin {

    @PluginMethod
    public void getSleepData(PluginCall call) {
        JSObject r = new JSObject();
        r.put("durationMinutes", JSONObject.NULL);
        r.put("quality", JSONObject.NULL);
        call.resolve(r);
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", false);
        call.resolve(r);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", false);
        call.resolve(r);
    }
}
