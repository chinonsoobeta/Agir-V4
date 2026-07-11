-- Retain pre- and post-deployment results with release evidence.
SELECT count(*) AS permit_cases FROM public.permit_cases;
SELECT count(*) AS standalone_cases FROM public.permit_cases WHERE project_id IS NULL;
SELECT count(*) AS linked_cases FROM public.permit_cases WHERE project_id IS NOT NULL;
SELECT count(*) AS permits_without_parent FROM public.project_permits WHERE case_id IS NULL AND project_id IS NULL;
SELECT count(*) AS duplicate_project_cases FROM (SELECT project_id FROM public.permit_cases WHERE project_id IS NOT NULL GROUP BY project_id HAVING count(*)>1) d;
SELECT count(*) AS case_documents FROM public.documents WHERE permit_case_id IS NOT NULL;
SELECT jurisdiction_type,count(*) FROM public.jurisdictions GROUP BY jurisdiction_type ORDER BY jurisdiction_type;
SELECT name,jurisdiction_type,regional_area FROM public.jurisdictions WHERE name IN ('Metro Vancouver','City of Kelowna');
SELECT j.name,count(*) AS rules FROM public.permit_rules r JOIN public.jurisdictions j ON j.id=r.jurisdiction_id GROUP BY j.name ORDER BY j.name;
SELECT conrelid::regclass AS table_name,conname FROM pg_constraint WHERE conrelid IN ('public.permit_cases'::regclass,'public.project_permits'::regclass,'public.documents'::regclass) ORDER BY 1,2;
SELECT tablename,policyname,cmd FROM pg_policies WHERE tablename LIKE 'permit%' OR (schemaname='public' AND tablename='documents') ORDER BY tablename,policyname;
