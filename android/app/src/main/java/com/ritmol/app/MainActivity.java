package com.ritmol.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RitmolHealthPlugin.class);
        registerPlugin(RitmolWidgetPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
