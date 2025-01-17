// Copyright (C) 2011-2015 Massachusetts Institute of Technology
// Chris Terman

jade_defs.export_mechanisms = function(jade) {
                                
    jade.schematic_view.schematic_tools.push(['netlist-extract',
                                                jade.icons.netlist_upload_icon,
                                                'Extract Netlist',
                                                extract_netlist]);

    // Not actually used for testing, but placing here for convenient UI location.
    jade.schematic_view.schematic_tools.push(['module-upload',
                                                jade.icons.module_upload_icon,
                                                'Save Current Module to a File',
                                                module_upload]);
                                                
    jade.schematic_view.schematic_tools.push(['module-combine',
                                                jade.icons.module_combine_icon,
                                                'Combine Modules in JSON files to a Single File',
                                                start_module_combine]);

    function extract_netlist(diagram) {
        var module = diagram.aspect.module;
        let default_name = module.get_name().replace(/\//g,'-').substr(1) + '-netlist.json'
        let netlist_filename = prompt('Enter the name of the file to save to:', default_name);
        if (netlist_filename === null) {
            alert('Netlist extraction cancelled.');
            return;
        }
        if (netlist_filename.slice(-5) !== '.json') {
            netlist_filename += '.json';
        }
        if (module) {
            var globals = Object.getOwnPropertyNames({});  // all the power supplies are global
            globals.push('gnd');
            try {
                netlist = jade.gate_level.diagram_gate_netlist(diagram,globals);
            }
            catch (e) {
                alert("Error extracting netlist: \n\n"+e);
                return;
            }
            url = diagram.editor.jade.configuration.cloud_url;
                var args = {
                    url: url,
                    type: 'POST',
                    dataType: 'text',
                    data: {key: window.location.pathname, netlist: JSON.stringify(netlist), netlist_name: netlist_filename},
                    error: function(jqXHR, textStatus, errorThrown) {
                        console.log('Error: '+jqXHR.responseText);
                        alert('Error: '+jqXHR.responseText);
                    },
                    success: function(result) {
                        //localStorage.setItem(window.location.pathname,result);
                        alert('Netlist uploaded to netlists/'+netlist_filename+'.');
                    }
                };
                $.ajax(args);
        }
    }

    function module_upload() {
        jade.module_upload($('.jade')[0].jade, window.location.origin);
    }

    function start_module_combine() {
        document.getElementById('multi-file-select-input').click();
    }

};
