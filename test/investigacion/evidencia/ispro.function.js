// JavaScript Document

	
	
	function recargaCaptcha(){
		document.getElementById('captcha_img').src = "/sitio/biblioteca/captcha2/images/button.png";
		document.getElementById('captcha_img').src = "/sitio/biblioteca/captcha2/captcha.php?rand="+Math.floor(Math.random()*32768);
	}
	function recargaCaptcha2(){
		document.getElementById('captcha_img2').src = "/sitio/biblioteca/captcha2/images/button.png";
		document.getElementById('captcha_img2').src = "/sitio/biblioteca/captcha2/captcha.php?rand="+Math.floor(Math.random()*32768);
	}
	
	jQuery(document).ready(function() {
		
		jQuery('#a_descarga').click(function(){
			$('#fcaptcha2').val('');
			$('#l_error4').hide();
			jQuery('#fcaptcha2').focus();
			data = '';
		jQuery('#exportar').dialog({
							autoOpen: true,
							modal: true,
							width: '400',
							height: 'auto',
							resizable: false,
							closeOnEscape: true,
							title: "Valide su descarga",
							open: function(){
								//$(this).parent().children().children("a.ui-dialog-titlebar-close").remove();
							},
						/*
							hide: {
								effect: "explode",
								duration: 1000,
								//fnDireccionar()
							},
						*/
							buttons: {
								
								Descargar: function() {
									$.post("/biblioteca/captcha2/captcha.php", { accion: "valida", valor: $('#fcaptcha2').val()},
											function(data){
												if(data=='1'){
													$('#l_error4').hide();
													
			                     window.open("descarga_ispro2.php?&peri="+$("#hid_maxp").val(), "_blank");
		
													$('#exportar').dialog('close');
												}else{
													$('#fcaptcha2').val('');
													$('#l_error4').show();
												}
											})
								
									
									//location.href='index.php?pagina=paginas.inicio&funcion=excelPrueba&excel_array='+excel_array;
									//$(this).dialog('close');
								}
								
								
							}
	
								
						});
		});
		


		jQuery('#b_descargar').click(function(){
			p_agno = jQuery('#s_agno').val();
			if(p_agno != 0000){
				periodo = p_agno+"12";
				jQuery('#l_error').css('display', 'none');
				
				$.post("/biblioteca/captcha2/captcha.php", { accion: "valida", valor: $('#fcaptcha').val()},
					function(data){
						if(data=='1'){
						    window.open("descarga_ispro2.php?&peri="+periodo, "_blank");  
						}else{
							jQuery('#l_error3').css('display', 'block');
							jQuery('#l_error').css('display', 'none');
							jQuery('#l_error2').css('display', 'none');
						}
					});
				
				

			}else{
				jQuery('#l_error2').css('display', 'none');
				jQuery('#l_error').css('display', 'block');
			}
		});


	
	})