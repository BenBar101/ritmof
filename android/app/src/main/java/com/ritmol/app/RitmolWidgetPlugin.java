package com.ritmol.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "RitmolWidget")
public class RitmolWidgetPlugin extends Plugin {

    @PluginMethod
    public void updateWidgetData(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences("ritmol_widget", Context.MODE_PRIVATE);
        if (call.getData() != null) {
            prefs.edit().putString("payload", call.getData().toString()).apply();
        }
        call.resolve();
    }
}
